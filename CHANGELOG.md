# Release notes

## 1.0.0 — prepared, unpublished

A clean format/API baseline and overhaul. All earlier payload compatibility is
dropped: no predecessor readers/emitters, legacy flags, implicit dispatch or
frozen executable copies. Historical measurements remain as data only.

- Five current packings: pair, ANS, Windows-1252, fast and compact UTF-8.
- Compact uses finite-state Wasm ANS, approximately 11.81% random-data overhead
  and millisecond-per-MiB decode; fast representation is chosen when smaller.
- Strict format and BLAKE3 defaults; optional XXH32 or no integrity verification.
- Selectable build subsets, lazy warm-up and optional pair lookup optimization.
- Owned output, unconditional allocation/state bounds, Chrome 109+ and file:// HTML.
- Compact guard checks avoid string rewrites for ordinary packets. Native Zopfli
  shrinks embedded Wasm without adding browser code; repeated build probes and
  small-asset compression are cached.
- Rust native tools, JS/Wasm browser paths, TypeScript declarations, 0BSD licensing.

Future compatibility considers released formats only. Unreleased experiments
never create reader obligations. Preparation creates no tag, GitHub release,
npm publication or Pages deployment.
