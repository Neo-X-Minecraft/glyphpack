# Matched compact-packing comparison

0BSD, NeoX. This follow-up isolates packing from the alphabet and HTML container
and tests whether a separate compact decoder is useful. Production stays intact.

[Results and recommendation](results/RESULTS.md) · [Tiny summary CSV](results/compact.csv) · [Representative inputs](results/decision.csv) ·
[All timings](results/timings.csv) · [Complete file-size matrix](results/standalone-sizes.csv)

All candidates use the production alphabet, production-selected XOR mask,
allocator, hashes, output ownership and public JS/Wasm adapter. The pair control
is compiled from unmodified kernel source using the same flags as the new
candidates. It is a matched build, not assumed byte-identical to a distributed
artifact. Pair-only, ANS-only and combined kernels are independently measured.

`compact.rs` is the optional unpacker, injected into a generated copy of the
production kernel by `../../../examples/compact.rs`. `encode.rs` contains the
native reference encoder. `check.cjs` validates all profile/policy combinations,
stale digests, bounds and missing-profile behavior in both actual browsers.
`report.rs` assembles raw evidence and CSVs. Shared warm/cold browser harnesses
live in `../packing/`; their default behavior is preserved.

## Try the experimental builder

From the repo root with `.tools/env.sh`, the pinned Rust/Node toolchain,
Binaryen and esbuild dependencies available:

```bash
source .tools/env.sh
cargo run --release --locked --example compact -- \
  --packing ans --output generated/compact-balanced.mjs
cargo run --release --locked --example compact -- \
  --packing ans-small --output generated/compact-smallest.mjs
cargo run --release --locked --example compact -- \
  --packing pair,ans --policy full --output generated/compact-combined.mjs
```

`ans` is the precise four-state profile; `ans-small` is precise one-state.
Comma-separated selections compile only those unpackers. Combined decoders
recognize their selected formats from the packet header, without a new runtime
`binary()` option. `--policy secure` is the default: format checking, BLAKE3 and
no heavy table. `full` permits all 12 verification/memory combinations; `core`
omits optional format and data verification. Modules include native gzip/base64
Wasm loading and emit matching declarations. This is an **example builder**;
the production `glyphpack build` CLI is unchanged.

The new packets are incompatible with format 3, using reserved header bands.
Use the native reference encoder here; existing format-3 payloads need a selected
pair decoder. An ANS-only module intentionally contains no pair unpacker. Keep
the current production encoder for existing consumers until a versioned format
is deliberately adopted.

## Reproduce the comparison

Generate public/synthetic corpora, all kernels, vectors and matched HTML first:

```bash
source .tools/env.sh
cargo run --release --locked --example encoder_compare -- --prepare
cargo run --release --locked --example compact
node benchmarks/experiments/compact/check.cjs
COMPACT_VARIANTS=pair-control,ans1,ans4,ans8,both-pair,both-ans4 \
COMPACT_DATASETS=empty,random-1KiB,random-1MiB,random-10MiB \
  cargo run --release --locked --example compact -- --documents
```

The following runs are sequential. Repeat each for the two browser configs:
`CHROMIUM_BIN=/usr/bin/chromium CHROMIUM_VERSION=156.0.8078.79` and
`CHROMIUM_BIN=.tools/chromium109/chromium CHROMIUM_VERSION=109.0.5414.119`.
Use their major versions in the output filenames.

```bash
export PACK_ROOT=generated/compact PACK_RUNS=3
PACK_VARIANTS=pair-control,pair,ans1,ans4,ans8,both-pair,both-ans4 \
PACK_DATASETS=random-1KiB,random-64KiB,random-1MiB,random-10MiB,zeros-1MiB,ff-1MiB,sequential-1MiB,json-logs,gzip-logs,utf8-text,decoder-wasm \
PACK_KINDS=2 node benchmarks/experiments/packing/measure.cjs generated/compact/main-156.json

PACK_POLICY_MATRIX=1 \
PACK_VARIANTS=pair-control-full,ans4-full,both-full-pair,both-full-ans4 \
PACK_DATASETS=random-1MiB,gzip-logs,zeros-1MiB PACK_KINDS=0,1,2 \
  node benchmarks/experiments/packing/measure.cjs generated/compact/policy-156.json

PACK_VARIANTS=pair-control-core,ans4-core,both-core-pair,both-core-ans4 \
PACK_DATASETS=random-1KiB,random-1MiB,random-10MiB,gzip-logs PACK_KINDS=0 \
  node benchmarks/experiments/packing/measure.cjs generated/compact/core-156.json
```

The cold harness runs both browsers itself; generate the final report after all
six warm campaigns and the cold campaign are available:

```bash
PACK_ROOT=generated/compact PACK_ROUNDS=3 node benchmarks/experiments/packing/cold.cjs
# Run the three "Try the experimental builder" commands above, then:
node benchmarks/experiments/compact/cli-check.cjs
cargo run --release --locked --example compact -- --report
```

Avoid concurrent compilers, corpus generators or other timing jobs. Warm setup
uses loopback outside timing and keeps one module/packet per page. Actual cold
files run offline under `file://`. Raw JSON, SHA-256 checks, process ranges and
all sample batches accompany the compact CSV. Generated packets and executables
stay under ignored `generated/compact/`; no private media is used.

The [physical transport follow-up](../transports/results/RESULTS.md) adds matched
Windows-1252 raw-script tests, retained memory, HTTP charset and Unicode probes,
and derives a recommendation for a full ANS migration versus packaging presets.
