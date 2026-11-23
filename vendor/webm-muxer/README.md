# webm-muxer (vendored)

- Version: **5.1.4**, npm package `webm-muxer` (Vanilagy), published 2025-07-02.
- Source: https://registry.npmjs.org/webm-muxer/-/webm-muxer-5.1.4.tgz
  (sha1 `9fa307bad3fb6e836c2a24d8fb729e4982ea88bc`, matches the registry's `dist.shasum`).
- License: MIT, see `LICENSE` (copied from the package).
- File copied unchanged: `webm-muxer.mjs` ← `package/build/webm-muxer.mjs` (65 KB).

Only the mission recording (video, WebM / VP9 or VP8 through WebCodecs, when the browser cannot encode H.264) loads it,
with `import()` in `js/record.js` when a video recording starts.

To update: download the new tarball, check its shasum against `https://registry.npmjs.org/webm-muxer/<version>`, copy
the same file, update this note.
