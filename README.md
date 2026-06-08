# Learn k-Wave

A GitHub Pages-ready teaching website for students learning k-Wave acoustic and ultrasound simulations, from basic wave physics to lab-ready transcranial focused ultrasound workflows.

## What is inside

- `index.html` - the website content and sections.
- `styles.css` - responsive layout and visual design.
- `script.js` - interactive acoustic wave, heterogeneous medium, k-space resolution, and phase-correction graphics.
- `materials/` - your original study guide, master guide, and layer 2 interactive example preserved for reference.
- `level3_3d_simulation.html`, `level4_3d_skull.html`, `level5_clinical_pipeline.html` - standalone clickable lab pages linked from the main guide.

## Current learning modules

- Basic acoustic wave physics.
- Heterogeneous medium and voxel-wise acoustic properties.
- k-space pseudospectral intuition.
- MATLAB setup through `kgrid`, `medium`, `source`, and `sensor`.
- Targeting, aberration, and phase correction.
- Advanced simulation decisions.
- Patient-image-to-k-Wave lab workflow.

## Interactive graphics

- Hero pressure-wave animation.
- Skull/brain heterogeneous medium explorer.
- Sound speed, density, attenuation, impedance, and CT HU map toggles.
- Frequency, points-per-wavelength, and CFL calculator.
- Phase correction sketch for transcranial focusing.

## Publish on GitHub Pages

1. Create a new GitHub repository, for example `learn-k-wave`.
2. Upload these files to the repository root.
3. In GitHub, open `Settings > Pages`.
4. Set `Source` to `Deploy from a branch`.
5. Choose the `main` branch and `/root`, then save.
6. Your site will appear at `https://YOUR-USERNAME.github.io/learn-k-wave/`.

## Personalize before sharing

- Add your name, institution, lab, and professor.
- Add course slides, assignments, or downloadable notebooks.
- Replace the starter code with examples from your own research.
- Add proper citation guidance from the official k-Wave website.

## Sources to keep nearby

- Official k-Wave website: https://www.k-wave.org/
- Official documentation: https://www.k-wave.org/documentation.php
- k-Wave Python documentation: https://k-wave-python.readthedocs.io/
