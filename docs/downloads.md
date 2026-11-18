# Start with GlyphPack 1.0.0

By NeoX, under 0BSD. Install `npm install glyphpack` for prebuilt decoder modules
and TypeScript declarations. Import `glyphpack` for secure pair or
`glyphpack/full` for all codecs and runtime options.

Open dist/standalone.html directly for an offline example. The workbench's HTML
exports also run under file:// without companion fetches. Separate ES modules
follow normal browser origin rules; inline Blob imports are used in exports.

- default/recommended: pair, strict BLAKE3, memory false.
- recommended-full: pair+ANS with the same fixed policies.
- full: all five current codecs and all selected verification/memory options.
- ans/windows/utf8/utf8-compact: secure single-codec profiles.
- core/none: pair without optional verification, retaining mandatory safety bounds.
- utf8-raw: current bare fast transport, structural checks and no digest.

Full exports binary and warmup only. Defaults are strict BLAKE3 and memory false.
Required Wasm is embedded as gzip/base64. Sizes and policies are in profiles.json.
Chrome 109+ is the browser target. Retired payload formats are unsupported.

A local npm archive can be installed with npm install ./glyphpack-1.0.0.tgz.
The native CLI's encode/inject commands work independently of the checkout.
Linux CLI archives are static x86_64/aarch64 binaries with third-party notices.
The web ZIP includes modules, declarations, examples, docs and benchmark results.
Individual modules and the standalone HTML are also available as release assets.
`SHA256SUMS` records the published asset checksums. The raw Wasm is an advanced
ABI artifact; normal users should import a module with its embedded loader.
See cli.md, configuration.md, format.md and the root README for commands and contracts.
