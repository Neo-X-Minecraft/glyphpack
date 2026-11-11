# Packing candidates

Local, isolated format experiments under 0BSD by NeoX. No production files,
release assets, GitHub branches or wire format are migrated by these commands.

[Results](results/RESULTS.md) · [Small decision CSV](results/decision.csv) ·
[Final timing matrix](results/timings.csv) · [Source-size matrix](results/sizes.csv)

## Implementation

- `encode.rs`: native reference packing; grouped 15/16–63/64-bit words,
  703-bit blocks and uniform ANS with one/four interleaved states.
- `core.rs`: allocation-free Rust unpackers, shared by native checks and Wasm.
- `kernel.rs`: specialized no-import Wasm adapter, mandatory bounds and trailer
  checks, reusable buffers, Unicode/byte/UTF-8 input readers and production hashes.
- `byte.js`: independent JavaScript unpackers and specialized Wasm bridges.
- `wide.js`: widened UTF-16 pair decoder control.
- `verify.js`: the unchanged production Wasm hash source for JavaScript controls.
- `base64.js`: `Uint8Array.fromBase64` on 156, `atob` fallback on 109, with matched
  output ownership and selected verification.
- `check.cjs`: both real browsers, owned outputs, short-header rejection, stale
  digests and surrogate alias rejection.
- `measure.cjs`: complete warmed decoder calls, one packet/module per page,
  three process medians and nine samples per process; setup excluded.
- `cold.cjs`: actual self-contained HTML, fresh browser/profile for every file,
  offline `file://`, first decode, exact byte hash and zero network requests.
- `protocol.cjs`: correct, absent and deliberately conflicting HTTP charsets.
- `report.rs` / `notes.md`: data aggregation and interpretation.
- `../../../examples/packing.rs`: Rust build, corpus, standalone HTML and report
  driver. The earlier template-literal experiment supplies contextual escaping.

Names such as `wasm16`, `wasm8` and `wasm-utf8` describe the **input bridge**, not
the document charset. `wasm16` copies JavaScript UTF-16 units and does lookup in
Wasm; `wasm8` maps digits in JavaScript first. The UTF-8 bridge uses native
`encodeInto`, rejects surrogate aliases, then parses and maps UTF-8 in Wasm.
`wide-ans16x4precise` packs two bytes at a time using four 47-bit ANS states.
All alternate methods have new headers and are incompatible with format 3.

## Reproduce

From the repository root, use the pinned Rust/Node toolchain, npm dependencies,
Binaryen, native gzip, `/usr/bin/chromium` 156.0.8078.79 and the Chrome 109 binary
at `.tools/chromium109/chromium`. Build production artifacts first if absent.

```bash
source .tools/env.sh
cargo run --release --locked --example encoder_compare -- --prepare
cargo run --release --locked --example packing
cargo run --release --locked --example packing -- --vectors
node benchmarks/experiments/packing/check.cjs
cargo run --release --locked --example packing -- --documents
node benchmarks/experiments/packing/protocol.cjs

export PACK_VARIANTS=production,wide-wasm,wide-ans16x4precise-wasm16,r254-ans4-wasm16,r254-group64-wasm16,r253-ans4-wasm16,base64-native
export PACK_DATASETS=random-1KiB,random-64KiB,random-1MiB,random-10MiB,zeros-1MiB,ff-1MiB,sequential-1MiB,json-logs,gzip-logs,utf8-text,decoder-wasm
export PACK_KINDS=0,1,2 PACK_RUNS=3
node benchmarks/experiments/packing/measure.cjs generated/packing/final-156.json
CHROMIUM_BIN=.tools/chromium109/chromium CHROMIUM_VERSION=109.0.5414.119 \
  node benchmarks/experiments/packing/measure.cjs generated/packing/final-109.json
PACK_ROUNDS=3 node benchmarks/experiments/packing/cold.cjs
cargo run --release --locked --example packing -- --report
```

Run timing jobs sequentially, without compilers, corpus generation or other
benchmarks competing for CPU. The steady harness uses a loopback server only to
load restored logical strings outside timing; actual file parsing is measured
separately by the offline cold harness. Large packet strings are not serialized
through DevTools or retained for every codec at once. This avoids setup-driven
renderer memory exhaustion.

`--build-only` recompiles isolated modules and updates manifest descriptors
without regenerating unchanged packets. `--reuse-build` regenerates corpus
packets using existing builds. `--test` runs only native boundary/round-trip
checks. Generated packets, Wasm, HTML and intermediate logs remain under ignored
`generated/packing/`. Measured raw samples and hashes are in `results/`.

The final HTML comparison uses the current full production runtime as the
baseline; alternate kernels specialize the transport and always verify format.
It measures the actual builds described, not the theoretical smallest possible
runtime for each format. Payload-source sizes isolate packing from runtime size.

The follow-up [matched compact-packing experiment](../compact/results/RESULTS.md)
holds the alphabet, production ABI and HTML container constant, and tests a
prototype builder axis with dedicated or combined unpackers.
