# Current integration

The 1.0.0 format and API are specified in [format.md](format.md). Full builds
support the five current packings, all three integrity modes, both format flags
and both pair memory strategies. Recommended profiles are pair-only or pair+ANS
with both verification policies fixed on.

Fast UTF-8 unpacks in JS. Pair, ANS, Windows and compact ANS run in Rust/Wasm,
sharing the same XXH32/BLAKE3 implementation. Compact verifies native output
directly; fast transport copies stored bytes to the shared verifier when needed.
There are no predecessor readers or compatibility exports. Full exposes only
binary and warmup. The current standalone utf8-raw leaf exposes decode/warmup.

Required Wasm uses gzip-9/base64 with native DecompressionStream, once at import.
Decode is synchronous afterward. Fast-UTF-8-only hashless builds omit Wasm.
Compact ANS needs no model table; adaptive fast transport shares a 4 KiB table.

Output is owned. Allocation/trailer/state guards are mandatory. Warm-up defaults
to exactly one safe available codec with memory false; only pair uses heavy lookup.
Standalone exports use an inline Blob-imported module for file://. Document
charset controls physical density. Current sizes are in dist/profiles.json.
