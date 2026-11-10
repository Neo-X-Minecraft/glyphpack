# Changelog

## 0.2.1 · 2026-11-10

- Hash four complete BLAKE3 chunks in parallel with portable Wasm SIMD128,
  retaining scalar tail/root processing and exact wire compatibility.
- Keep native browser base64/gzip and memory operations; preserve the existing
  JavaScript API, verification defaults, allocation guards and buffer ownership.
- Support an explicit `RUSTFLAGS="-C target-feature=-simd128"` MVP build override.
- Add `dist/standalone.html` and automated offline `file://` checks for UTF-8 and
  UTF-16LE documents on Chrome 109 and current Chromium.
- Add official-vector checks through the actual Wasm verifier and calibrated
  paired comparisons of all twelve runtime combinations.


## 0.2.0 · 2026-11-10

- Batch four independent Rust mask scores for faster exact and sampled search,
  while preserving deterministic mask choices and encoded bytes.
- Offer a dependency-free Rust codec with `default-features = false`; keep CLI,
  builder and JSON/report tooling in the default `tools` feature.
- Make native tools relocatable, add `--version`, and locate source checkouts
  through the current directory or `GLYPHPACK_ROOT`.
- Add specialized TypeScript declarations, custom `--types` output, and tests
  installing the actual npm tarball on Node 20 and 22.
- Add reproducible raw/compact browser and encoder benchmarks, paired comparison
  tools, SVG reports, GitHub measurement jobs and provenance checks.
- Publish a framework-free Pages workbench with six examples, local file
  processing, verification demonstrations and standalone HTML exports.
- Add tested static Linux x86_64/aarch64 CLI archives and browser ZIP packaging
  with dependency notices and checksums.
- Extend CI to Rust 1.85, native ARM64, the dependency-free library and package
  consumers, alongside all 63 specialized Wasm builds and browser checks.

Wire format 3, `binary()` behavior, defaults and decoder implementation remain
compatible with 0.1.0. Fixed-size-table and branchless decoder experiments were
rejected when they did not provide a useful performance improvement.

## 0.1.0 · 2026-11-10

Initial Rust/Wasm payload codec, specialized modules, native encoder and injector,
allocation-safety and integrity regressions, Chrome 109 compatibility, and 0BSD
licensing under NeoX.
