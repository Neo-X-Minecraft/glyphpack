# Physical transport and migration comparison

0BSD, NeoX. Follow-up to the [matched compact codec tests](../compact/README.md).
These local experiments compare the current UTF-16 pair codec, UTF-16 ANS and
Windows-1252 ANS with the **same raw-script HTML container** and production
allocator, selected XOR mask, hash functions and JS/Wasm adapter.

[Decision and full analysis](results/RESULTS.md) · [Four-row CSV](results/compact.csv) ·
[All decode timings](results/timings.csv) · [Migration size budgets](results/migration-sizes.csv)

## Files

- `windows.rs`: byte-symbol ANS with four u32 states. All length/state/trailer
  guards are independent of the shared production verifier.
- `../../../examples/transports.rs`: native build, corpus and raw HTML driver.
  It reuses the experimental builder's compiler/adapter path, changes only a
  generated copy of the kernel and produces two Windows alphabets.
- `check.cjs`: short-header/truncation rejection and SHA-256 output checks on
  both actual browsers, using the exact benchmark artifacts.
- `compat.cjs`: Unicode source representability, escaped HTML/JS display and
  correctly transcoded UTF-8 documents. Records actual UTF-8 byte costs.
- `report.rs` / `notes.md`: separate charset restrictions, information bounds,
  payload type, decoder profile and complete-file bytes in the recommendation.

The 254-symbol alphabet excludes CR and less-than. Source NUL deliberately
becomes U+FFFD in HTML script data. The 253-symbol variant additionally excludes
NUL and does not depend on that mapping. Both support arbitrary decoded binary
data; Windows-1252 is a document charset, not a Windows operating-system API.

The Windows headers use the six-digit reference format from the prior packing
experiment. These modules are selected separately; this is not a production
format migration or a promise to decode the different alphabets automatically.
The prototype's UTF-16 modules and public native encoder retain their existing
behavior. No published artifacts or production defaults are changed.

## Reproduce

First prepare the compact experiment's corpora and candidate modules as described
in its README. Then, from the repo root:

```bash
source .tools/env.sh
cargo run --release --locked --example transports
node benchmarks/experiments/transports/check.cjs
PACK_ROOT=generated/transports node benchmarks/experiments/packing/protocol.cjs
```

Run both warm campaigns sequentially, without compiling or preparing files in
parallel. `PACK_MEMORY=1` temporarily observes Wasm instantiation during setup;
the original API is restored before the timer. Reported memory is retained
linear-memory capacity after a call, not peak memory of the application.

```bash
export PACK_ROOT=generated/transports PACK_MEMORY=1 PACK_RUNS=3 PACK_KINDS=2
export PACK_VARIANTS=pair-control,ans4,windows254,windows253
export PACK_DATASETS=random-1KiB,random-64KiB,random-1MiB,random-10MiB,json-logs,gzip-logs,zeros-1MiB,utf8-text,decoder-wasm
node benchmarks/experiments/packing/measure.cjs generated/transports/main-156.json
CHROMIUM_BIN=.tools/chromium109/chromium CHROMIUM_VERSION=109.0.5414.119 \
  node benchmarks/experiments/packing/measure.cjs generated/transports/main-109.json
PACK_ROOT=generated/transports PACK_ROUNDS=3 node benchmarks/experiments/packing/cold.cjs
node benchmarks/experiments/transports/compat.cjs
cargo run --release --locked --example transports -- --report
```

The cold campaign uses actual standalone `file://` pages, zero network access
and a fresh browser/profile per file. Charset tests deliberately include an
incorrect UTF-8 HTTP header. Unicode tests distinguish direct source restrictions
from the ability to display arbitrary text. The final report also compares three
existing decoder build policies; those size budgets exclude HTML framing and
are explicitly distinguished from measured complete HTML.
