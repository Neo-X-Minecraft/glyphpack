# Measurements and reproduction

The benchmark corpus is independent of any other project. All built-in fixtures
are generated locally from deterministic seeds or public patterns. Caller files
are optional and remain under ignored `generated/`.

## Decoder comparison

```sh
npm ci
cargo build --release --locked
CHROMIUM_BIN=/path/to/chromium glyphpack bench smoke
CHROMIUM_BIN=/path/to/chromium glyphpack bench run
glyphpack summary
```

`smoke` checks compatibility; `run` uses three fresh browser processes, three
warm-ups and nine measured batches. `CHROMIUM_VERSION` must explicitly match a
browser other than the pinned Chromium 156.0.8078.79. Reports go to
`generated/results/`. The timer covers resident encoded text to fresh bytes and
the selected verification; input generation, imports and correctness checks are
excluded. First calls share an imported module and are not cold page loads.

The comparison includes all twelve GlyphPack choices and matched none/XXH32/
BLAKE3 tiers for native Base64, atob, Base122, the local Base121 extension and
Base85. Peer structural validation differs. Candidate screening finds the
fastest correct tested implementation per family, not a proven global optimum.
Base121 is a local `<`-excluding extension; Base85 partial blocks and alphabet
dialects are identified in the report. Vendor licenses remain beside the source.

Compact CSVs and charts are presentation summaries. For analysis, retain the
environment, exact module hashes, raw samples and run ranges. Filter raw CSV
records by `record_type=sample`, `stage=comparison`, and `phase=measured`.
Batch averages do not describe individual-call tail latency.

```sh
glyphpack bench run --input example.wasm --input archive.gz
glyphpack summary --input generated/results/encoding-decode-benchmark.csv \
  --output generated/results/report
```

## Encoder measurements

```sh
cargo run --release --locked --example encoder_compare -- --prepare
cargo run --release --locked --example encoder_compare -- \
  --output generated/results/encoder-paired.json
cargo run --release --locked --features parallel-encoder --example encoder_compare -- \
  --output generated/results/encoder-parallel.json
node benchmarks/encoder.cjs before/encoder.mjs after/encoder.mjs \
  generated/results/encoder-browser.json
```

The Rust example prepares public patterns, JSON logs, compressed logs, UTF-8 text
and the decoder's own bytecode. `--quick` narrows native coverage; `--large` adds
10 MiB. Browser controls are `ENCODER_RUNS`, `ENCODER_QUICK` and `ENCODER_LARGE`.
The browser comparison checks encoded text and round-trip bytes before timing,
and verifies all 63,385 alphabet units through the native UTF-16 bridge. It
compares the frozen legacy bridge with the actual current host module. It times
input copy, packing, selected verification, JS output construction and character
consumption. This can materialize a legacy concatenated string. Fresh output is
measured natively; the browser reuses each engine's output capacity.

The frozen Rust reference is `benchmarks/fixtures/encoder-v0.2.1.rs`. Build its
browser encoder from the retained v0.2.1 tag in a separate worktree. Treat
parallel-enabled native runs as a separate configuration. Do not combine their
absolute timings with another process or browser campaign.

```sh
cargo run --release --locked --example encode_bench -- \
  --output generated/results/encoder.json > generated/results/encoder.csv
```

The native harness covers fixed, sampled and exact masks, all three verification
modes and UTF-16LE/u16/UTF-8 outputs. It includes hashing, mask selection and new
output allocation; input generation, output hashing and buffer drop are outside
the timer. Paired comparisons alternate old/new calls and compare output bytes
before timing. CPU clocks, temperature and affinity are unpinned.

## Archived algorithm experiments

`glyphpack bench history --quick` rechecks generic frozen decoder implementations
using public fixtures. Omit `--quick` for the full candidate/profile/hash matrix.
`glyphpack history-report` aggregates a completed campaign. Campaign fingerprints
prevent phases from different inputs or source versions being mixed.

The fixtures include public hash vectors and all 63 build profiles. Old decoder
algorithms are comparison references, not production fallback code. Module
loading, source evaluation and calibration are excluded from their steady-state
timers. Retain the saved browser version, source hashes and bridge details when
comparing results. One unpinned host does not establish a universal cutoff.
