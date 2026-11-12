# Decoder search

0BSD, NeoX. Only `../prefix-throughput.mjs` or `../prefix-split.mjs`, together
with `../prefix.mjs`, enter native example builds. Everything here is research.
Models are separate snapshots so changing the delivered table representation
cannot silently change a candidate or add a second model to its bundle.

- `baseline.min.mjs`: byte-exact previous 2,154-byte delivered artifact from
  `ab610e7`, intentionally stored as compiled code. **Do not reformat it.**
  The preparation runner checks SHA-256 before use.
- `candidates.mjs`: twelve alternate kernels with their invariant comments.
  Dead-code elimination retains only the selected function and its table.
- `model-wide.mjs`: original unsigned 8 KiB representation with compact ranges.
- `model-narrow.mjs`, `narrow.mjs`: complete 4 KiB sentinel model/loop.
- `model-split.mjs`, `split.mjs`: complete 6 KiB width/value model/loop.
- `direct.mjs`, `smallest.mjs`: original loop with shared-header or shared-all
  cold error messages; used to separate size and dispatch effects.
- `wasm.mjs`: benchmark-only embedded Wasm loader, native UTF-8 conversion and
  owned output copy. Its kernel is built from the Rust fixtures.

```sh
source .tools/env.sh
cargo run --release --locked -- bench prepare
cargo run --release --locked --example utf8_prefix
cargo run --release --locked --example utf8_prefix -- build generated/utf8-prefix/decoder.min.mjs
cargo run --release --locked --example utf8_prefix -- build generated/utf8-prefix/decoder-balanced.min.mjs --balanced
cargo run --release --locked --example utf8_prefix -- build generated/utf8-prefix/decoder-full.min.mjs --all-profiles
cargo run --release --locked --example utf8_prefix -- build generated/utf8-prefix/decoder.iife.js --classic
cargo run --release --locked --example utf8_prefix -- html generated/encoding-comparison/random-1MiB.bin generated/utf8-prefix/example.html
node benchmarks/utf8-prefix-compat.cjs
node benchmarks/utf8-speed-prepare.cjs --wasm
SPEED_VARIANTS=before,delivered,balanced SPEED_LABEL=selected SPEED_RUNS=3 SPEED_ROUNDS=9 node benchmarks/utf8-speed.cjs
SPEED_VARIANTS=before,delivered,balanced,speculative,wordStores,splitTables,sentinel,stateTable,wideStateTable,byteInput,bounded,asciiPairs,fullTable,asciiSpec,asciiConditional,narrow,splitModel,smallest,wasmBytes SPEED_LABEL=search node benchmarks/utf8-speed.cjs
node benchmarks/utf8-speed-report.cjs
```

`SPEED_ROUNDS` defaults to five, `SPEED_RUNS` to one. Both target browsers must
be installed; `CHROMIUM_BIN` and `CHROMIUM109_BIN` can override their locations.
Set `WASM_OPT` if Binaryen is elsewhere. `--simd` also builds the optional SIMD
research kernel; it is excluded from the normal screen because this Chromium
renderer crashed. Import time includes embedded Wasm compilation/instantiation;
warm time includes every input/output transfer.

The driver first runs byte/error comparisons in separate browser processes,
then starts new processes for measurement. Raw strings and generated modules
remain under ignored `generated/`; only aggregate results and public source
snapshots are committed. `summary.csv` is the small shareable view. Keep the
JSON for artifact hashes, input hashes, environment and raw batches.
