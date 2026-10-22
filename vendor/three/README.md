# Three.js (vendored)

- Version: **0.186.1** (r186), npm package `three`, published 2026-09-24.
- Source: https://registry.npmjs.org/three/-/three-0.186.1.tgz
  (sha1 `6d50f70c2c437f844179bbb56d6f5b774e1ca38a`, matches the registry's `dist.shasum`).
- License: MIT, see `LICENSE` (copied from the package).
- Files are copied unchanged from the package:
  - `three.module.js`, `three.core.js` ← `package/build/` (r186 ships no `.min.js`; GitHub Pages serves them
    gzip-compressed, ~420 KB together)
  - `addons/lines/{Line2,LineGeometry,LineMaterial,LineSegments2,LineSegmentsGeometry}.js` ← `package/examples/jsm/lines/`

Only the 3D view mode loads these, through `import()` in `js/mode3d.js` and the import map in `index.html`
(`three` → `three.module.js`, `three/addons/` → `addons/`). The 2D modes never fetch them.

To update: download the new tarball, check its shasum against `https://registry.npmjs.org/three/<version>`,
copy the same files, update this note and the version in `CLAUDE.md`.
