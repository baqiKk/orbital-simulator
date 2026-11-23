# gifenc (vendored)

- Version: **1.0.3**, npm package `gifenc` (Matt DesLauriers), published 2021-03-07.
- Source: https://registry.npmjs.org/gifenc/-/gifenc-1.0.3.tgz
  (sha1 `3a1a97fa5ab70ebefd000350b9aac8313b30b3aa`, matches the registry's `dist.shasum`).
- License: MIT, see `LICENSE.md` (copied from the package).
- File copied unchanged: `gifenc.esm.js` ← `package/dist/gifenc.esm.js` (9 KB).

Only the mission recording (GIF) loads it: the module worker `js/rec-worker.js` imports it when a GIF recording starts.
The simulator never fetches it otherwise.

To update: download the new tarball, check its shasum against `https://registry.npmjs.org/gifenc/<version>`, copy the
same file, update this note.
