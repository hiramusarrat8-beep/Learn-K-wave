const simCanvas = document.querySelector("#simCanvas");
const simCtx = simCanvas && simCanvas.getContext("2d");
const brainMRI = new Image();
brainMRI.src = "brain-mri.jpg"; // place this file in the project folder

// Polyfill roundRect for browsers that don't support it yet
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.arcTo(x + w, y, x + w, y + r, r);
    this.lineTo(x + w, y + h - r);
    this.arcTo(x + w, y + h, x + w - r, y + h, r);
    this.lineTo(x + r, y + h);
    this.arcTo(x, y + h, x, y + h - r, r);
    this.lineTo(x, y + r);
    this.arcTo(x, y, x + r, y, r);
    this.closePath();
    return this;
  };
}

const whyCanvas = document.querySelector("#whyCanvas");
const whyCtx = whyCanvas.getContext("2d");
const mediumCanvas = document.querySelector("#mediumCanvas");
const mediumCtx = mediumCanvas.getContext("2d");
const kspaceCanvas = document.querySelector("#kspaceCanvas");
const kspaceCtx = kspaceCanvas.getContext("2d");
const phaseCanvas = document.querySelector("#phaseCanvas");
const phaseCtx = phaseCanvas.getContext("2d");
const wavepathCanvas = document.querySelector("#wavepathCanvas");
const wavepathCtx = wavepathCanvas && wavepathCanvas.getContext("2d");

let time = 0;
let currentMap = "c";
let revealMode = "outside";
let skullThick = 8;
let skullDens = 1.0;
let wpThick = 8;
let simFreq = 500;
let simDepth = 40;
let simLateral = 0;
let simCorrect = true;
let simPressure = null;
let simNeedRecompute = true;

function fitCanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * scale));
  canvas.height = Math.max(220, Math.floor(rect.height * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function resizeAll() {
  if (simCanvas) { fitCanvas(simCanvas, simCtx); simNeedRecompute = true; }
  fitCanvas(whyCanvas, whyCtx);
  fitCanvas(mediumCanvas, mediumCtx);
  fitCanvas(kspaceCanvas, kspaceCtx);
  fitCanvas(phaseCanvas, phaseCtx);
  if (wavepathCanvas) fitCanvas(wavepathCanvas, wavepathCtx);
  drawBrainSim();
  drawWhySimulation();
  drawMedium();
  drawKspace();
  drawPhase();
  drawWavePath();
}

function drawHeroWave() {
  drawBrainSim();
  time += 0.045;
  drawWhySimulation();
  drawWavePath();
  requestAnimationFrame(drawHeroWave);
}

// ── Hardcoded sulci (normalized: multiply by brain rx/ry) ────────────
// Each entry: [startPt, endPt, controlPt]  all inside unit ellipse (mag < 1)
const SULCI = [
  [[-0.60, -0.55], [-0.72, -0.65], [-0.66, -0.50]],
  [[-0.40, -0.50], [-0.48, -0.64], [-0.44, -0.44]],
  [[-0.18, -0.46], [-0.22, -0.60], [-0.20, -0.40]],
  [[ 0.10, -0.44], [ 0.16, -0.58], [ 0.13, -0.38]],
  [[ 0.36, -0.36], [ 0.46, -0.52], [ 0.41, -0.30]],
  [[ 0.55, -0.18], [ 0.64, -0.36], [ 0.60, -0.12]],
  [[ 0.60,  0.14], [ 0.68, -0.04], [ 0.64,  0.16]],
  [[ 0.52,  0.38], [ 0.62,  0.22], [ 0.57,  0.36]],
  [[-0.62, -0.26], [-0.70, -0.08], [-0.66, -0.17]],
  [[-0.60,  0.10], [-0.68, -0.04], [-0.64,  0.04]],
];

function getSimGeo(W, H) {
  const cx = W * 0.50, cy = H * 0.535;
  const rx = Math.min(W * 0.32, H * 0.40);
  const ry = Math.min(H * 0.44, W * 0.38);
  const skullPx = Math.max(7, rx * 0.09);
  const depthNorm   = (simDepth  - 30) / 40;
  const latNorm     =  simLateral / 30;
  const focX = cx + latNorm * (rx - skullPx) * 0.50;
  const focY = (cy - ry + skullPx) + depthNorm * (ry - skullPx) * 0.82;
  const N = 16, arcSpan = 0.62 * Math.PI;
  const els = [];
  for (let i = 0; i < N; i++) {
    const angle = -Math.PI / 2 + (i / (N - 1) - 0.5) * arcSpan;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const ellR = (rx * ry) / Math.sqrt(ry * ry * cosA * cosA + rx * rx * sinA * sinA);
    const gap  = skullPx * 0.4 + Math.max(4, W * 0.016);
    els.push({ x: cx + (ellR + gap) * cosA, y: cy + (ellR + gap) * sinA, angle });
  }
  return { cx, cy, rx, ry, skullPx, focX, focY, els };
}

function inBrain(x, y, g) {
  const dx = (x - g.cx) / (g.rx - g.skullPx);
  const dy = (y - g.cy) / (g.ry - g.skullPx);
  return dx * dx + dy * dy < 1;
}

function recomputeSim() {
  if (!simCanvas) return;
  const W = simCanvas.clientWidth  > 10 ? simCanvas.clientWidth  : 580;
  const H = simCanvas.clientHeight > 10 ? simCanvas.clientHeight : 374;
  const g = getSimGeo(W, H);
  const STEP = 5;
  const gW = Math.ceil(W / STEP), gH = Math.ceil(H / STEP);
  const rePart = new Float32Array(gW * gH);
  const imPart = new Float32Array(gW * gH);
  const fHz   = simFreq * 1e3;
  const pxPerM = W / 0.20;
  const k      = (2 * Math.PI * fHz / 1560) / pxPerM;
  const alpBr  = 0.6 * (fHz / 1e6) * Math.log(10) / 20 / (pxPerM * 0.01);
  const skullAtt = Math.exp(-15 * 0.8 * (fHz / 1e6) * Math.log(10) / 20);
  const { els, focX, focY } = g;
  for (let gy = 0; gy < gH; gy++) {
    for (let gx = 0; gx < gW; gx++) {
      const px = gx * STEP + STEP / 2, py = gy * STEP + STEP / 2;
      if (!inBrain(px, py, g)) continue;
      let re = 0, im = 0;
      for (const el of els) {
        const dx = px - el.x, dy = py - el.y;
        const r    = Math.sqrt(dx * dx + dy * dy) || 1;
        const dfx  = focX - el.x, dfy = focY - el.y;
        const rFoc = Math.sqrt(dfx * dfx + dfy * dfy) || 1;
        const phi  = simCorrect ? k * rFoc : 0;
        const amp  = skullAtt * Math.exp(-alpBr * r) / Math.sqrt(r);
        re += amp * Math.cos(k * r - phi);
        im += amp * Math.sin(k * r - phi);
      }
      rePart[gy * gW + gx] = re;
      imPart[gy * gW + gx] = im;
    }
  }
  simPressure = { rePart, imPart, gW, gH, STEP, g, W, H };
  simNeedRecompute = false;
}

// Jet colormap: blue → cyan → green → yellow → red
function jetColor(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if      (t < 0.125) { r = 0;             g = 0;              b = 0.5 + 4 * t; }
  else if (t < 0.375) { r = 0;             g = 4*(t-0.125);    b = 1; }
  else if (t < 0.625) { r = 4*(t-0.375);   g = 1;              b = 1-4*(t-0.375); }
  else if (t < 0.875) { r = 1;             g = 1-4*(t-0.625);  b = 0; }
  else                { r = 1-4*(t-0.875); g = 0;              b = 0; }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

// ── Procedural fallback brain (used when brain-mri.jpg is absent) ──
function drawProceduralBrain(ctx, geo, W, H) {
  const { cx, cy, rx, ry, skullPx } = geo;
  const brx = rx - skullPx, bry = ry - skullPx;
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#272727";
  ctx.beginPath(); ctx.ellipse(cx, cy, rx + 4, ry + 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#e0e0e0";
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#0e1218";
  ctx.beginPath(); ctx.ellipse(cx, cy, brx + skullPx * 0.22, bry + skullPx * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  const bGrad = ctx.createRadialGradient(cx, cy - bry * 0.1, 0, cx, cy + bry * 0.1, Math.max(brx, bry));
  bGrad.addColorStop(0, "#888"); bGrad.addColorStop(0.4, "#777");
  bGrad.addColorStop(0.75, "#5a5a5a"); bGrad.addColorStop(1, "#3e3e3e");
  ctx.fillStyle = bGrad;
  ctx.beginPath(); ctx.ellipse(cx, cy, brx, bry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#aaa";
  ctx.beginPath(); ctx.ellipse(cx, cy - bry * 0.02, brx * 0.28, bry * 0.09, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath(); ctx.ellipse(cx, cy + bry * 0.06, brx * 0.1, bry * 0.09, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#585858";
  ctx.beginPath(); ctx.ellipse(cx + brx * 0.42, cy + bry * 0.5, brx * 0.22, bry * 0.2, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(135,135,135,0.4)"; ctx.lineWidth = 2;
  for (let a = -Math.PI + 0.2; a < Math.PI * 0.8; a += 0.18) {
    ctx.beginPath();
    ctx.moveTo(cx + brx * 0.68 * Math.cos(a), cy + bry * 0.68 * Math.sin(a));
    ctx.quadraticCurveTo(
      cx + brx * 0.75 * Math.cos(a + 0.11), cy + bry * 0.75 * Math.sin(a + 0.11),
      cx + brx * 0.82 * Math.cos(a + 0.15), cy + bry * 0.82 * Math.sin(a + 0.15)
    );
    ctx.stroke();
  }
}

function drawBrainSim() {
  if (!simCanvas || !simCtx) return;
  if (simCanvas.clientWidth < 10) return;
  const ctx = simCtx;
  const W = simCanvas.clientWidth, H = simCanvas.clientHeight;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);

  const geo = getSimGeo(W, H);
  const { cx, cy, rx, ry, skullPx, focX, focY } = geo;

  // ── 1. MRI background — fit full image height, no vertical crop ───
  if (brainMRI.complete && brainMRI.naturalWidth > 0) {
    // Scale so the full image height fits the canvas; center horizontally
    const scale = H / brainMRI.naturalHeight;
    const dW    = Math.round(brainMRI.naturalWidth * scale);
    const dX    = Math.round((W - dW) / 2);
    ctx.globalAlpha = 0.92;
    ctx.drawImage(brainMRI, 0, 0, brainMRI.naturalWidth, brainMRI.naturalHeight, dX, 0, dW, H);
    ctx.globalAlpha = 1;
    // Subtle vignette so overlay pops
    const vig = ctx.createRadialGradient(W*0.5, H*0.5, H*0.28, W*0.5, H*0.5, H*0.72);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
  } else {
    drawProceduralBrain(ctx, geo, W, H);
  }

  // ── 2. Transducer geometry (tracks lateral focus position) ────────
  // Find skull outer surface directly above the focus lateral position
  const dxN = Math.max(-0.88, Math.min(0.88, (focX - cx) / rx));
  const skullSurfY = cy - ry * Math.sqrt(1 - dxN * dxN); // top of skull at focX
  const txFaceY    = skullSurfY - 52;                     // transducer face (raised above skull)
  const txApertW   = rx * 0.54;                           // aperture width
  const txBodyH    = 26;                                  // housing height
  const txBodyTop  = txFaceY - txBodyH;
  const N_EL       = 16;

  // Coupling gel (semi-transparent wedge between transducer and skull surface)
  ctx.fillStyle = "rgba(160,205,240,0.18)";
  ctx.beginPath();
  ctx.moveTo(focX - txApertW / 2, txFaceY);
  ctx.lineTo(focX + txApertW / 2, txFaceY);
  // Follow skull curvature at bottom of gel
  const gelSteps = 24;
  for (let s = gelSteps; s >= 0; s--) {
    const t   = s / gelSteps;
    const xN  = dxN + (t - 0.5) * (txApertW / rx);
    const xNC = Math.max(-0.9, Math.min(0.9, xN));
    const gx  = cx + xNC * rx;
    const gy  = cy - ry * Math.sqrt(1 - xNC * xNC);
    ctx.lineTo(gx, gy);
  }
  ctx.closePath(); ctx.fill();

  // Housing body (rounded rect)
  ctx.fillStyle = "#c8d8ee";
  ctx.strokeStyle = "#7090b8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(focX - txApertW / 2 - 10, txBodyTop, txApertW + 20, txBodyH, 5);
  ctx.fill(); ctx.stroke();

  // Active face stripe
  ctx.fillStyle = "#6a9ac8";
  ctx.fillRect(focX - txApertW / 2, txFaceY - 7, txApertW, 7);

  // Individual element lines on face
  ctx.fillStyle = "rgba(200,228,255,0.85)";
  for (let i = 0; i < N_EL; i++) {
    const elX = focX - txApertW / 2 + (i / (N_EL - 1)) * txApertW;
    ctx.fillRect(elX - 1, txFaceY - 7, 2, 7);
  }

  // Cable connector at top
  ctx.strokeStyle = "#5a7898"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(focX - 5, txBodyTop); ctx.lineTo(focX - 5, txBodyTop - 14);
  ctx.moveTo(focX + 5, txBodyTop); ctx.lineTo(focX + 5, txBodyTop - 14);
  ctx.stroke();

  // Label
  ctx.fillStyle = "rgba(200,224,255,0.95)";
  ctx.font = '700 9px "SFMono-Regular",Consolas,monospace';
  ctx.textAlign = "center";
  ctx.fillText("tFUS", focX, txBodyTop + 12);

  // ── 3. Converging wavefronts (arcs centred at focus, shrink to 0) ─
  // Transducer is directly above focus → waves go straight down (dirAngle = -π/2)
  const maxDist  = focY - txFaceY;           // distance from face to focus
  const dirAngle = -Math.PI / 2;             // always straight down
  const arcHalf  = 0.60;                     // aperture half-angle
  const N_WAVES  = 8;
  const waveSpeed = 0.72;

  for (let i = 0; i < N_WAVES; i++) {
    const phase = ((time * waveSpeed) + i / N_WAVES) % 1.0;
    const r     = maxDist * (1 - phase);
    if (r < 4) continue;

    const brightness = Math.sin(phase * Math.PI);

    // Skull attenuation: dim wavefront while it is in the skull band
    const midWaveY = focY - r;  // arc midpoint Y (at dirAngle = -π/2)
    const inSkull  = midWaveY >= skullSurfY && midWaveY <= (skullSurfY + skullPx);
    const skullFactor = inSkull ? 0.28 : 1.0;

    const alpha = (brightness * 0.80 * skullFactor).toFixed(3);
    ctx.strokeStyle = `rgba(55,170,255,${alpha})`;
    ctx.lineWidth = 1.4 + brightness * 0.9;
    ctx.setLineDash([]);

    if (simCorrect) {
      ctx.beginPath();
      ctx.arc(focX, focY, r, dirAngle - arcHalf, dirAngle + arcHalf);
      ctx.stroke();
    } else {
      // Aberrated: wobbly wavefront (skull causes irregular delays)
      ctx.beginPath();
      const SEG = 40;
      for (let s = 0; s <= SEG; s++) {
        const angle  = dirAngle - arcHalf + (s / SEG) * arcHalf * 2;
        const distort = 13 * Math.sin(angle * 7 + time * 2.2) * brightness;
        const rD = r + distort;
        const px = focX + rD * Math.cos(angle);
        const py = focY + rD * Math.sin(angle);
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  // ── 4. Intensity spot at focus ────────────────────────────────────
  const pulseR = simCorrect
    ? 13 + Math.sin(time * 5) * 3    // tight pulsing (corrected)
    : 30 + Math.sin(time * 3) * 6;   // wide diffuse (aberrated)

  // Blue ring — spatial extent
  const blueR  = pulseR * 1.9;
  const blueGr = ctx.createRadialGradient(focX, focY, pulseR * 0.5, focX, focY, blueR);
  blueGr.addColorStop(0,    "rgba(20,80,255,0)");
  blueGr.addColorStop(0.42, "rgba(20,80,255,0.44)");
  blueGr.addColorStop(1,    "rgba(20,80,255,0)");
  ctx.fillStyle = blueGr;
  ctx.beginPath();
  ctx.ellipse(focX, focY, blueR * 1.2, blueR * 0.70, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Orange/amber hot-spot — pressure peak
  const hotGr = ctx.createRadialGradient(focX - pulseR*0.1, focY - pulseR*0.1, 0, focX, focY, pulseR);
  hotGr.addColorStop(0,    "rgba(255,228,80,0.98)");
  hotGr.addColorStop(0.28, "rgba(255,130,15,0.90)");
  hotGr.addColorStop(0.65, "rgba(210,35,5,0.55)");
  hotGr.addColorStop(1,    "rgba(180,0,0,0)");
  ctx.fillStyle = hotGr;
  ctx.beginPath();
  ctx.ellipse(focX, focY, pulseR, pulseR * 0.72, -0.15, 0, Math.PI * 2);
  ctx.fill();

  // ── 5. Dashed target box ──────────────────────────────────────────
  ctx.strokeStyle = "rgba(0,230,100,0.88)";
  ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  ctx.strokeRect(focX - 26, focY - 26, 52, 52);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(0,220,100,0.95)";
  ctx.font = '700 10px "SFMono-Regular",Consolas,monospace';
  ctx.textAlign = "left";
  ctx.fillText("TARGET", focX + 30, focY + 4);

  // ── 6. Info label ─────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.52)";
  ctx.font = '10px "SFMono-Regular",Consolas,monospace';
  ctx.textAlign = "left";
  ctx.fillText(
    `${simFreq} kHz · ${simDepth} mm depth · ${simCorrect ? "phase corrected ✓" : "aberrated (no correction) ✗"}`,
    12, H - 12
  );
}

function drawWhySimulation() {
  const width = whyCanvas.clientWidth;
  const height = whyCanvas.clientHeight;
  const ctx = whyCtx;
  const freq = Number(document.querySelector("#why-frequency").value);
  const skull = Number(document.querySelector("#why-skull").value);
  const depth = Number(document.querySelector("#why-depth").value);
  const targetX = width * (0.42 + depth / 220);
  const targetY = height * 0.52;
  const transducerX = width * 0.1;
  const transducerY = height * 0.52;
  const skullX = width * 0.46;
  const complexity = skull / 10;
  const focusShift = complexity * 44 * Math.sin(time * 0.55);
  const focusBlur = 12 + complexity * 42 + (freq > 750 ? 14 : 0);

  document.querySelector("#why-freq-out").textContent = `${freq} kHz`;
  document.querySelector("#why-depth-out").textContent = `${depth} mm`;
  const skullLabel = skull < 3 ? "low" : skull < 7 ? "medium" : "high";
  document.querySelector("#why-skull-out").textContent = skullLabel;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111a20";
  ctx.fillRect(0, 0, width, height);

  const tissue = ctx.createLinearGradient(0, 0, width, 0);
  tissue.addColorStop(0, "#17242c");
  tissue.addColorStop(0.38, "#183b3f");
  tissue.addColorStop(0.5, "#5b5145");
  tissue.addColorStop(0.58, "#2d524d");
  tissue.addColorStop(1, "#18312f");
  ctx.fillStyle = tissue;
  ctx.fillRect(width * 0.2, height * 0.16, width * 0.72, height * 0.68);

  ctx.fillStyle = "#f2f5f4";
  ctx.beginPath();
  ctx.ellipse(transducerX, transducerY, 24, height * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.fillText("transducer", width * 0.04, height * 0.17);

  ctx.fillStyle = "rgba(236, 213, 177, 0.9)";
  ctx.beginPath();
  for (let y = height * 0.18; y <= height * 0.82; y += 8) {
    const wobble = Math.sin(y * 0.04 + time) * (6 + skull * 1.4);
    const x = skullX + wobble;
    if (y === height * 0.18) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let y = height * 0.82; y >= height * 0.18; y -= 8) {
    const wobble = Math.sin(y * 0.045 + time + 2) * (5 + skull * 1.1);
    ctx.lineTo(skullX + width * 0.055 + wobble, y);
  }
  ctx.closePath();
  ctx.fill();

  if (revealMode !== "outside") {
    for (let i = 0; i < 9; i += 1) {
      const t = i / 8;
      const controlX = skullX + complexity * 50 * Math.sin(t * Math.PI * 2 + time);
      const endX = targetX + focusShift * (0.25 + t * 0.65);
      const endY = targetY + (t - 0.5) * focusBlur;
      ctx.strokeStyle = `rgba(99, 209, 189, ${0.2 + 0.5 * (1 - Math.abs(t - 0.5))})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(transducerX + 22, transducerY + (t - 0.5) * height * 0.3);
      ctx.quadraticCurveTo(controlX, height * (0.34 + t * 0.35), endX, endY);
      ctx.stroke();
    }

    for (let r = 0; r < 9; r += 1) {
      const radius = 18 + r * 22 + (time * 18) % 22;
      const alpha = Math.max(0, 0.16 - r * 0.014);
      ctx.strokeStyle = `rgba(95, 211, 196, ${alpha})`;
      ctx.beginPath();
      ctx.arc(transducerX + 18, transducerY, radius, -0.7, 0.7);
      ctx.stroke();
    }
  }

  if (revealMode === "risk" || revealMode === "focus") {
    const hotSpots = [
      [skullX + 16, height * 0.37, 24 + skull * 2],
      [skullX + 32, height * 0.62, 18 + skull * 1.5],
      [targetX + focusShift * 0.8, targetY + 20, 22],
    ];
    hotSpots.forEach(([x, y, r]) => {
      const heat = ctx.createRadialGradient(x, y, 0, x, y, r);
      heat.addColorStop(0, "rgba(245, 154, 82, 0.78)");
      heat.addColorStop(1, "rgba(245, 154, 82, 0)");
      ctx.fillStyle = heat;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (revealMode === "focus") {
    const focus = ctx.createRadialGradient(targetX + focusShift, targetY, 0, targetX + focusShift, targetY, focusBlur);
    focus.addColorStop(0, "rgba(240, 211, 125, 0.95)");
    focus.addColorStop(0.35, "rgba(99, 209, 189, 0.45)");
    focus.addColorStop(1, "rgba(99, 209, 189, 0)");
    ctx.fillStyle = focus;
    ctx.beginPath();
    ctx.arc(targetX + focusShift, targetY, focusBlur, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(targetX, targetY, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(255,255,255,0.84)";
  ctx.font = "700 13px system-ui, sans-serif";
  ctx.fillText("planned target", targetX + 14, targetY - 12);
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.font = "12px system-ui, sans-serif";
  const captions = {
    outside: "Without simulation, we see the setup but not the internal pressure field.",
    hidden: "An MRI or fMRI view can show anatomy or activity, but not the full acoustic pressure field.",
    simulation: "Simulation links the planned target, transducer placement, and predicted acoustic field.",
    field: "Simulation reveals how the wave bends, delays, and loses energy inside tissue.",
    risk: "Simulation helps locate reflection and heating risks before a lab run.",
    focus: "Simulation estimates whether the acoustic focus reaches the intended target.",
  };
  ctx.fillText(captions[revealMode], width * 0.06, height - 26);
}

function updateWhyImageScene() {
  const stage = document.querySelector(".why-image-stage");
  const outside = document.querySelector(".why-scene-outside");
  const hidden = document.querySelector(".why-scene-hidden");
  const kicker = document.querySelector("#why-scene-kicker");
  const title = document.querySelector("#why-scene-title");
  const copy = document.querySelector("#why-scene-copy");
  if (!stage || !outside || !hidden || !kicker || !title || !copy) return;

  stage.classList.toggle("show-hidden", revealMode === "hidden");
  stage.classList.toggle("show-simulation", revealMode === "simulation");
  outside.classList.toggle("active", revealMode === "outside");
  hidden.classList.toggle("active", revealMode !== "outside");

  const text = {
    outside: {
      kicker: "Outside setup",
      title: "We can see the head and transducer.",
      copy: "The hardware placement is visible, but the pressure field after the wave enters tissue is not directly visible during the experiment.",
    },
    hidden: {
      kicker: "Inside is unknown",
      title: "Images show anatomy, not the acoustic field.",
      copy: "MRI or fMRI can orient us to the brain and possible target region, but they do not tell us exactly how ultrasound pressure propagates through skull and tissue.",
    },
    simulation: {
      kicker: "Simulation helps",
      title: "Simulation predicts the acoustic field before the lab run.",
      copy: "Modeling the pressure field lets researchers verify transducer placement and focus quality without relying on direct measurement inside tissue.",
    },
  };

  const next = text[revealMode] || text.outside;
  kicker.textContent = next.kicker;
  title.textContent = next.title;
  copy.textContent = next.copy;
}

function drawWavePath() {
  if (!wavepathCanvas || !wavepathCtx) return;
  const ctx = wavepathCtx;
  const W = wavepathCanvas.clientWidth;
  const H = wavepathCanvas.clientHeight;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#111a20";
  ctx.fillRect(0, 0, W, H);

  const freq = Number(document.querySelector("#wp-frequency").value) * 1000;
  const gelMm = 5, csfMm = 3, brainMm = 50;
  const totalMm = gelMm + wpThick + csfMm + brainMm;
  const txW = Math.round(W * 0.09);
  const margin = Math.round(W * 0.03);
  const usable = W - txW - margin;
  const pxMm = usable / totalMm;

  const gx = txW;
  const sx = gx + gelMm * pxMm;
  const cx_ = sx + wpThick * pxMm;
  const bx = cx_ + csfMm * pxMm;
  const ex = bx + brainMm * pxMm;   // intended target x
  const midY = Math.round(H * 0.5);

  const C_GEL = 1500, C_SKULL = 2900, C_CSF = 1500, C_BRAIN = 1560;

  // ── Beam geometry with Snell's law ────────────────────────────────
  // The transducer emits a converging beam aimed at (ex, midY).
  // Snell's law at each vertical interface (normal = x-direction):
  //   sin(θ_t) = sin(θ_i) * c2/c1   (small-angle: slope_t ≈ slope_i * c2/c1)
  const hw0 = H * 0.21;            // beam half-width at transducer face
  const s_gel = hw0 / (ex - gx);   // convergence slope aimed at ex
  const s_skull = s_gel * (C_SKULL / C_GEL);   // steeper in skull (c2 > c1)
  const s_csf   = s_skull * (C_CSF / C_SKULL); // relaxes back
  const s_brain  = s_csf   * (C_BRAIN / C_CSF);

  // Half-width at each interface
  const hw_sx = hw0        - s_gel   * (sx  - gx);
  const hw_cx = Math.max(0, hw_sx   - s_skull * (cx_ - sx));
  const hw_bx = Math.max(0, hw_cx   - s_csf   * (bx  - cx_));

  // Actual focus: where hw → 0 in brain region
  const xFocus = hw_bx > 0 ? bx + hw_bx / s_brain : bx;

  function hw(px) {
    if (px <= gx)  return hw0;
    if (px <= sx)  return Math.max(0, hw0   - s_gel   * (px - gx));
    if (px <= cx_) return Math.max(0, hw_sx  - s_skull * (px - sx));
    if (px <= bx)  return Math.max(0, hw_cx  - s_csf   * (px - cx_));
    return Math.max(0, hw_bx - s_brain * (px - bx));
  }

  // ── Region backgrounds ────────────────────────────────────────────
  const regions = [
    { x: 0,   w: txW,       bg: "#0e1c24", label: "TRANSDUCER",           lc: "#63d1bd" },
    { x: gx,  w: sx  - gx,  bg: "#112530", label: "GEL",                  lc: "#63d1bd", speed: "1500 m/s",             sc: "#63d1bd" },
    { x: sx,  w: cx_ - sx,  bg: "#2a0f0f", label: "SKULL",                lc: "#e8c080", speed: "c = 2900\naberration", sc: "#e8c080" },
    { x: cx_, w: bx  - cx_, bg: "#0f2028", label: "CSF",                  lc: "#8fa79c" },
    { x: bx,  w: W   - bx,  bg: "#0d201e", label: "BRAIN TISSUE → TARGET",lc: "#d75f4f", speed: "1560 m/s",             sc: "#d75f4f" },
  ];

  regions.forEach((r) => { ctx.fillStyle = r.bg; ctx.fillRect(r.x, 0, r.w, H); });

  [gx, sx, cx_, bx].forEach((x) => {
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  });

  // ── Labels ───────────────────────────────────────────────────────
  ctx.textAlign = "center";
  regions.forEach((r) => {
    const lx = r.x + r.w / 2;
    ctx.fillStyle = r.lc;
    ctx.font = '700 10px "SFMono-Regular",Consolas,monospace';
    ctx.fillText(r.label, lx, H * 0.14);
    if (r.speed) {
      r.speed.split("\n").forEach((line, i) => {
        ctx.fillStyle = r.sc;
        ctx.font = '10px "SFMono-Regular",Consolas,monospace';
        ctx.fillText(line, lx, H * 0.78 + i * 13);
      });
    }
  });

  // ── Multi-ray refraction fan ──────────────────────────────────────
  // Show 7 rays from transducer converging toward focus.
  // Each ray obeys Snell's law at skull entry and exit, producing visible kinks.
  const N = 7;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1) - 0.5) * 2;   // -1 (top) → +1 (bottom)
    if (Math.abs(t) < 0.05) continue;     // skip center — drawn as the wave below

    const yStart = midY + t * hw0;
    // Slope in gel aimed at (ex, midY)
    const sg = (midY - yStart) / (ex - gx);

    // Snell at gel→skull: sinθ_t = sinθ_i * c_skull/c_gel
    const sinTi_g = Math.abs(sg) / Math.hypot(1, sg);
    const sinTt_s = Math.min(0.9999, sinTi_g * (C_SKULL / C_GEL));
    const ss = Math.sign(sg) * Math.tan(Math.asin(sinTt_s));

    // Snell at skull→csf: sinθ_t = sinθ_i * c_csf/c_skull
    const sinTi_s = Math.abs(ss) / Math.hypot(1, ss);
    const sinTt_b = Math.min(0.9999, sinTi_s * (C_CSF / C_SKULL));
    const sb = Math.sign(ss) * Math.tan(Math.asin(sinTt_b));

    const ySx = yStart + sg * (sx  - gx);
    const yCx = ySx    + ss * (cx_ - sx);
    const yFx = yCx    + sb * (xFocus - cx_);

    const a = 0.1 + 0.2 * (1 - Math.abs(t));

    ctx.lineWidth = 1;
    // Gel segment
    ctx.strokeStyle = `rgba(120,160,255,${a})`;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(gx, yStart); ctx.lineTo(sx, ySx); ctx.stroke();
    // Skull segment — visible kink at sx
    ctx.strokeStyle = `rgba(220,195,130,${a})`;
    ctx.beginPath(); ctx.moveTo(sx, ySx); ctx.lineTo(cx_, yCx); ctx.stroke();
    // Brain segment — second kink at cx_, converges to focus
    ctx.strokeStyle = `rgba(210,80,80,${a})`;
    ctx.beginPath(); ctx.moveTo(cx_, yCx); ctx.lineTo(xFocus, yFx); ctx.stroke();
  }

  // ── Converging beam envelope (dashed) ────────────────────────────
  const envEnd = Math.min(xFocus, W - 2);
  ctx.strokeStyle = "rgba(100,150,255,0.28)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 5]);
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    for (let px = gx; px <= envEnd; px++) {
      const y = midY + sign * hw(px);
      if (px === gx) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Central animated wave (amplitude = beam half-width) ───────────
  // Wave oscillates within the envelope; amplitude → 0 at focus.
  const waveSpeeds = [
    { start: gx,  end: sx,     c: C_GEL   },
    { start: sx,  end: cx_,    c: C_SKULL  },
    { start: cx_, end: bx,     c: C_CSF    },
    { start: bx,  end: envEnd, c: C_BRAIN  },
  ];
  const wSeg = (px) => waveSpeeds.find((s) => px >= s.start && px < s.end) || waveSpeeds[waveSpeeds.length - 1];

  const rr = (x) => Math.max(0, Math.min(1, (x - gx) / (envEnd - gx)));
  const grad = ctx.createLinearGradient(gx, 0, envEnd, 0);
  grad.addColorStop(0,                        "#7b9df7");
  grad.addColorStop(Math.max(0, rr(sx)-0.02), "#a8c8ff");
  grad.addColorStop(rr(sx),                   "#d8eaff");
  grad.addColorStop(Math.min(0.99,rr(cx_)-0.01), "#f0f0f8");
  grad.addColorStop(rr(cx_),                  "#f0a870");
  grad.addColorStop(rr(bx),                   "#ef6040");
  grad.addColorStop(1,                         "#d03050");

  ctx.beginPath();
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  let cumPhase = -time * 2.8;
  for (let px = gx; px <= envEnd; px++) {
    const { c } = wSeg(px);
    const lambdaPx = (c / freq) * 1000 * pxMm;
    cumPhase += (2 * Math.PI) / lambdaPx;
    const y = midY - Math.sin(cumPhase) * hw(px);
    if (px === gx) ctx.moveTo(px, y); else ctx.lineTo(px, y);
  }
  ctx.stroke();

  // ── Refraction labels at skull interfaces ─────────────────────────
  [
    [sx,  "θ₁→θ₂  n↑", hw_sx],
    [cx_, "θ₂→θ₁  n↓", hw_cx],
  ].forEach(([x, label, hwAt]) => {
    ctx.strokeStyle = "rgba(240,200,80,0.55)";
    ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, midY - hwAt - 10); ctx.lineTo(x, midY + hwAt + 10); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(240,200,80,0.9)";
    ctx.font = '9px "SFMono-Regular",Consolas,monospace';
    ctx.textAlign = "center";
    ctx.fillText(label, x, midY - hwAt - 14);
  });

  // ── Transducer bar ────────────────────────────────────────────────
  ctx.fillStyle = "#5588ff";
  ctx.fillRect(txW - 5, midY - hw0 * 1.05, 5, hw0 * 2.1);

  // ── Focus point (actual, where rays converge) ─────────────────────
  const fX = Math.min(xFocus, W - margin * 0.5);
  const glowR = 13 + Math.sin(time * 3) * 3;
  const glow = ctx.createRadialGradient(fX, midY, 0, fX, midY, glowR);
  glow.addColorStop(0, "rgba(240,179,79,0.75)");
  glow.addColorStop(1, "rgba(240,179,79,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(fX, midY, glowR, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = "#f0b34f"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(fX, midY, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#f0b34f";
  ctx.beginPath(); ctx.arc(fX, midY, 3, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#f0b34f";
  ctx.font = '700 10px "SFMono-Regular",Consolas,monospace';
  ctx.textAlign = "center";
  ctx.fillText("FOCUS", fX, midY + H * 0.33);

  // ── Intended target (when skull has shifted focus away from it) ────
  if (ex < W - 5 && ex - fX > 14) {
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(ex, midY, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = '9px "SFMono-Regular",Consolas,monospace';
    ctx.fillText("intended", ex, midY + H * 0.33);
  }
}

function getLayers() {
  const t = skullThick;
  const d = skullDens;
  const outerThick = Math.round(t * 0.35);
  const trabThick = Math.round(t * 0.3);
  return [
    { name: "Gel", mmStart: 0, mmEnd: 5, c: 1500, rho: 1000, alpha: 0.002, hu: -5 },
    { name: "Scalp", mmStart: 5, mmEnd: 10, c: 1560, rho: 1050, alpha: 0.5, hu: 50 },
    {
      name: "Outer cortical",
      mmStart: 10,
      mmEnd: 10 + outerThick,
      c: Math.round(2900 * d),
      rho: Math.round(1900 * d),
      alpha: 15 * d,
      hu: Math.round(900 * d),
    },
    {
      name: "Trabecular",
      mmStart: 10 + outerThick,
      mmEnd: 10 + outerThick + trabThick,
      c: Math.round(2100 * d * 0.9 + 200),
      rho: Math.round(1400 * d * 0.9 + 100),
      alpha: 9 * d,
      hu: Math.round(400 * d),
    },
    {
      name: "Inner cortical",
      mmStart: 10 + outerThick + trabThick,
      mmEnd: 10 + t,
      c: Math.round(2800 * d),
      rho: Math.round(1850 * d),
      alpha: 14 * d,
      hu: Math.round(850 * d),
    },
    { name: "Brain", mmStart: 10 + t, mmEnd: 70, c: 1560, rho: 1040, alpha: 0.6, hu: 35 },
  ];
}

function mapColor(value, min, max, palette) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  if (palette === "warm") {
    return `rgb(${Math.round(36 + 210 * t)}, ${Math.round(166 - 86 * t)}, ${Math.round(198 - 150 * t)})`;
  }
  if (palette === "cool") {
    return `rgb(${Math.round(40 + 30 * t)}, ${Math.round(120 + 100 * t)}, ${Math.round(170 + 40 * t)})`;
  }
  const v = Math.round(232 - 150 * t);
  return `rgb(${v}, ${v}, ${Math.max(50, v - 12)})`;
}

function drawMedium() {
  const width = mediumCanvas.clientWidth;
  const height = mediumCanvas.clientHeight;
  const ctx = mediumCtx;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111a20";
  ctx.fillRect(0, 0, width, height);

  const layers = getLayers();
  const xOff = width * 0.08;
  const usable = width * 0.84;
  const pxPerMm = usable / 70;
  const barY = height * 0.13;
  const barH = height * 0.28;
  const waveY = height * 0.62;
  const waveH = height * 0.22;

  layers.forEach((layer) => {
    const x1 = xOff + layer.mmStart * pxPerMm;
    const x2 = xOff + layer.mmEnd * pxPerMm;
    const w = x2 - x1;
    let value = layer.c;
    let min = 1400;
    let max = 3000;
    let palette = "warm";
    if (currentMap === "rho") {
      value = layer.rho;
      min = 900;
      max = 2000;
      palette = "gray";
    } else if (currentMap === "alpha") {
      value = layer.alpha;
      min = 0;
      max = 16;
      palette = "cool";
    } else if (currentMap === "Z") {
      value = (layer.c * layer.rho) / 1e6;
      min = 1.4;
      max = 5.6;
    } else if (currentMap === "HU") {
      value = layer.hu;
      min = -100;
      max = 1000;
      palette = "gray";
    }

    ctx.fillStyle = mapColor(value, min, max, palette);
    ctx.fillRect(x1, barY, w, barH);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(x1, barY, w, barH);
    if (w > 54) {
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(layer.name, x1 + w / 2, barY + barH / 2 - 7);
      ctx.font = "11px system-ui, sans-serif";
      const label = propertyLabel(layer);
      ctx.fillText(label, x1 + w / 2, barY + barH / 2 + 11);
    }
  });

  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (let mm = 0; mm <= 70; mm += 10) {
    const x = xOff + mm * pxPerMm;
    ctx.fillText(String(mm), x, barY + barH + 24);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(x, barY + barH);
    ctx.lineTo(x, barY + barH + 10);
    ctx.stroke();
  }
  ctx.fillText("depth in mm", xOff + usable / 2, barY + barH + 42);

  const skullStart = xOff + 10 * pxPerMm;
  const skullEnd = xOff + (10 + skullThick) * pxPerMm;
  ctx.strokeStyle = "rgba(240,179,79,0.9)";
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(skullStart, barY - 14);
  ctx.lineTo(skullStart, waveY + waveH);
  ctx.moveTo(skullEnd, barY - 14);
  ctx.lineTo(skullEnd, waveY + waveH);
  ctx.stroke();
  ctx.setLineDash([]);

  const points = [];
  for (let x = xOff; x <= xOff + usable; x += 2) {
    const mm = (x - xOff) / pxPerMm;
    const layer = layers.find((item) => mm >= item.mmStart && mm < item.mmEnd) || layers[layers.length - 1];
    const lambdaMm = (layer.c / 500000) * 1000;
    const atten = Math.exp(-layer.alpha * mm * 0.012);
    const y = waveY + waveH / 2 - Math.sin((mm / lambdaMm) * Math.PI * 4) * atten * waveH * 0.42;
    points.push([x, y]);
  }
  ctx.beginPath();
  ctx.strokeStyle = "#62d1bd";
  ctx.lineWidth = 2;
  points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();

  layers.slice(1).forEach((layer, index) => {
    const previous = layers[index];
    const r = Math.abs((layer.c * layer.rho - previous.c * previous.rho) / (layer.c * layer.rho + previous.c * previous.rho));
    const x = xOff + layer.mmStart * pxPerMm;
    if (r > 0.05) {
      ctx.strokeStyle = `rgba(245,154,82,${Math.min(1, r * 3 + 0.25)})`;
      ctx.lineWidth = 1 + r * 5;
      ctx.beginPath();
      ctx.moveTo(x, waveY - 12);
      ctx.lineTo(x, waveY + waveH + 8);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,219,168,0.95)";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`${Math.round(r * 100)}% refl`, x, waveY - 18);
    }
  });

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  const labels = {
    c: "Color = sound speed. Faster bone bends phase and changes wavelength.",
    rho: "Color = density. Density combines with sound speed to set impedance.",
    alpha: "Color = attenuation. Bone absorbs and scatters much more energy.",
    Z: "Color = impedance Z = rho c. Sharp Z jumps create reflected pressure.",
    HU: "Color = CT Hounsfield units. HU maps are often converted into acoustic maps.",
  };
  ctx.fillText(labels[currentMap], xOff, height - 18);
}

function propertyLabel(layer) {
  if (currentMap === "rho") return `${layer.rho} kg/m3`;
  if (currentMap === "alpha") return `${layer.alpha.toFixed(1)} dB/MHz/cm`;
  if (currentMap === "Z") return `${((layer.c * layer.rho) / 1e6).toFixed(2)} MRayl`;
  if (currentMap === "HU") return `${layer.hu} HU`;
  return `${layer.c} m/s`;
}

function updateMediumInfo(mm) {
  const layers = getLayers();
  const layer = layers.find((item) => mm >= item.mmStart && mm < item.mmEnd) || layers[layers.length - 1];
  document.querySelector("#ic-c").textContent = `${layer.c} m/s`;
  document.querySelector("#ic-rho").textContent = `${layer.rho} kg/m3`;
  document.querySelector("#ic-Z").textContent = `${((layer.c * layer.rho) / 1e6).toFixed(2)} MRayl`;
  document.querySelector("#ic-alpha").textContent = `${layer.alpha.toFixed(1)} dB/MHz/cm`;
}

function drawKspace() {
  const width = kspaceCanvas.clientWidth;
  const height = kspaceCanvas.clientHeight;
  const ctx = kspaceCtx;
  const f0 = Number(document.querySelector("#ks-frequency").value) * 1000;
  const ppw = Number(document.querySelector("#ks-ppw").value);
  const cfl = Number(document.querySelector("#ks-cfl").value);
  const c0 = 1500;
  const lambdaMm = (c0 / f0) * 1000;
  const dxMm = lambdaMm / ppw;
  const dtUs = (cfl * (dxMm / 1000) / c0) * 1e6;

  document.querySelector("#out-f0").textContent = `${Math.round(f0 / 1000)} kHz`;
  document.querySelector("#out-ppw").textContent = String(ppw);
  document.querySelector("#out-cfl").textContent = cfl.toFixed(2);
  document.querySelector("#calc-lambda").textContent = `${lambdaMm.toFixed(2)} mm`;
  document.querySelector("#calc-dx").textContent = `${dxMm.toFixed(2)} mm`;
  document.querySelector("#calc-dt").textContent = `${dtUs.toFixed(2)} us`;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111a20";
  ctx.fillRect(0, 0, width, height);
  const left = 46;
  const right = width - 24;
  const mid = height * 0.48;
  const amp = height * 0.18;
  const cycles = 3.2;

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= ppw * cycles; i += 1) {
    const x = left + (i / (ppw * cycles)) * (right - left);
    ctx.beginPath();
    ctx.moveTo(x, mid - amp - 26);
    ctx.lineTo(x, mid + amp + 26);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.strokeStyle = "#63d1bd";
  ctx.lineWidth = 3;
  for (let i = 0; i <= 360; i += 1) {
    const x = left + (i / 360) * (right - left);
    const y = mid - Math.sin((i / 360) * Math.PI * 2 * cycles) * amp;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.83)";
  ctx.font = "700 13px system-ui, sans-serif";
  ctx.fillText(`${ppw} grid points per wavelength`, left, 34);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("Higher PPW improves resolution but increases memory and runtime.", left, height - 28);

  const stability = cfl <= 0.3 ? "conservative" : cfl <= 0.45 ? "watch carefully" : "risky";
  ctx.fillStyle = cfl <= 0.3 ? "#a7e8c3" : cfl <= 0.45 ? "#f0d37d" : "#f59a82";
  ctx.fillText(`CFL setting: ${stability}`, left, height - 10);
}

function drawPhase() {
  const width = phaseCanvas.clientWidth;
  const height = phaseCanvas.clientHeight;
  const ctx = phaseCtx;
  const delay = Number(document.querySelector("#phase-delay").value);
  const elements = Number(document.querySelector("#phase-elements").value);
  document.querySelector("#out-delay").textContent = `${delay} us`;
  document.querySelector("#out-elements").textContent = String(elements);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111a20";
  ctx.fillRect(0, 0, width, height);

  const arrayY = height * 0.82;
  const focus = { x: width * 0.5, y: height * 0.22 };
  const startX = width * 0.14;
  const gap = (width * 0.72) / (elements - 1);
  const blur = Math.min(1, delay / 90);

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.ellipse(focus.x, focus.y, 28 + blur * 52, 16 + blur * 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f0b34f";
  ctx.beginPath();
  ctx.arc(focus.x, focus.y, 5, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < elements; i += 1) {
    const x = startX + i * gap;
    const offset = Math.sin((i / Math.max(1, elements - 1)) * Math.PI * 2) * delay * 0.16;
    ctx.fillStyle = "#e8edf0";
    ctx.fillRect(x - 4, arrayY - 8, 8, 16);

    ctx.strokeStyle = `rgba(99, 209, 189, ${0.18 + 0.62 * (1 - blur)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, arrayY - 8);
    ctx.quadraticCurveTo((x + focus.x) / 2 + offset, height * 0.52, focus.x, focus.y);
    ctx.stroke();

    ctx.strokeStyle = `rgba(245, 154, 82, ${0.16 + 0.55 * blur})`;
    ctx.beginPath();
    ctx.moveTo(x, arrayY + 8);
    ctx.quadraticCurveTo((x + focus.x) / 2 - offset * 1.4, height * 0.55, focus.x + offset * 1.2, focus.y + blur * 25);
    ctx.stroke();
  }

  const uncorrected = Math.round(100 - blur * 62);
  const corrected = Math.round(86 + (1 - blur) * 10);
  document.querySelector("#calc-uncorrected").textContent = `${uncorrected}% coherence`;
  document.querySelector("#calc-corrected").textContent = `${corrected}% coherence`;

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = "700 13px system-ui, sans-serif";
  ctx.fillText("orange = distorted arrival, teal = corrected timing", 28, 32);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("Time reversal estimates the delays each array element should compensate.", 28, height - 24);
}

document.querySelectorAll("[data-map]").forEach((button) => {
  button.addEventListener("click", () => {
    currentMap = button.dataset.map;
    document.querySelectorAll("[data-map]").forEach((item) => item.classList.toggle("active", item === button));
    drawMedium();
  });
});

document.querySelectorAll("[data-reveal]").forEach((button) => {
  button.addEventListener("click", () => {
    revealMode = button.dataset.reveal;
    document.querySelectorAll("[data-reveal]").forEach((item) => item.classList.toggle("active", item === button));
    drawWhySimulation();
    updateWhyImageScene();
  });
});

document.querySelectorAll("[data-layer-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const targetId = button.dataset.layerTab;
    document.querySelectorAll("[data-layer-tab]").forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));
    });
    document.querySelectorAll(".layer-detail-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === targetId);
    });
    document.querySelector("#learning-layers")?.scrollIntoView({ behavior: "smooth", block: "start" });
    requestAnimationFrame(resizeAll);
  });
});

["#why-frequency", "#why-skull", "#why-depth"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", drawWhySimulation);
});

mediumCanvas.addEventListener("mousemove", (event) => {
  const rect = mediumCanvas.getBoundingClientRect();
  const width = mediumCanvas.clientWidth;
  const xOff = width * 0.08;
  const usable = width * 0.84;
  const mm = ((event.clientX - rect.left - xOff) / usable) * 70;
  if (mm >= 0 && mm <= 70) updateMediumInfo(mm);
});

document.querySelector("#sl-thick").addEventListener("input", (event) => {
  skullThick = Number(event.target.value);
  document.querySelector("#out-thick").textContent = `${skullThick} mm`;
  drawMedium();
});

document.querySelector("#sl-dens").addEventListener("input", (event) => {
  skullDens = Number(event.target.value);
  const labels = {
    0.5: "osteoporotic",
    0.6: "low",
    0.7: "low",
    0.8: "below avg",
    0.9: "below avg",
    1.0: "normal",
    1.1: "above avg",
    1.2: "dense",
    1.3: "very dense",
    1.4: "very dense",
    1.5: "max",
  };
  document.querySelector("#out-dens").textContent = labels[event.target.value] || event.target.value;
  drawMedium();
});

["#ks-frequency", "#ks-ppw", "#ks-cfl"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", drawKspace);
});

["#phase-delay", "#phase-elements"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", drawPhase);
});

// sim controls removed — defaults: 500 kHz, 40 mm depth, 0 lateral, phase correction ON

document.querySelector("#wp-frequency").addEventListener("input", (e) => {
  document.querySelector("#wp-freq-out").textContent = `${e.target.value} kHz`;
});

document.querySelector("#wp-thick").addEventListener("input", (e) => {
  wpThick = Number(e.target.value);
  document.querySelector("#wp-thick-out").textContent = `${wpThick} mm`;
});

// ── Code comment highlighting ──────────────────────────────────────
// Wraps everything from % to end-of-line in .code-cmt so comments
// appear in a muted colour, separate from the main code colour.
function highlightComments() {
  const targets = [
    "pre.layer2-pre code",
    "pre.prop-code",
  ];
  targets.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.innerHTML = el.innerHTML
        .split("\n")
        .map((line) => {
          const idx = line.indexOf("%");
          if (idx === -1) return line;
          return (
            line.slice(0, idx) +
            '<span class="code-cmt">' +
            line.slice(idx) +
            "</span>"
          );
        })
        .join("\n");
    });
  });
}
highlightComments();

// Layer accordion (Layer 5 & 6)
window.toggleLayerAcc = function(btn) {
  const item = btn.closest(".lacc-item");
  const body = item.querySelector(".lacc-body");
  const isOpen = item.classList.contains("open");
  item.classList.toggle("open", !isOpen);
  body.classList.toggle("open", !isOpen);
};

window.addEventListener("resize", resizeAll);
resizeAll();
updateWhyImageScene();
drawHeroWave();
