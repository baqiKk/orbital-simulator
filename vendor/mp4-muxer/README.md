# mp4-muxer (vendored)

- Version: **5.2.2**, npm package `mp4-muxer` (Vanilagy), published 2025-07-02.
- Source: https://registry.npmjs.org/mp4-muxer/-/mp4-muxer-5.2.2.tgz
  (sha1 `40b93b1b727f5f4a9fbda131fe7c5b5013168bf1`, matches the registry's `dist.shasum`).
- License: MIT, see `LICENSE` (copied from the package).
- File copied unchanged: `mp4-muxer.mjs` ← `package/build/mp4-muxer.mjs` (69 KB).

Only the mission recording (video, MP4 / H.264 through WebCodecs) loads it, with `import()` in `js/record.js` when a
video recording starts.

To update: download the new tarball, check its shasum against `https://registry.npmjs.org/mp4-muxer/<version>`, copy
the same file, update this note.
