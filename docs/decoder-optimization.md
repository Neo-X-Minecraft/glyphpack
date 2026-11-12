# Decoder size and initialization tuning

This local campaign compares the exact modules from `6214588` with the new
builds. The public API, format-4 packets, format-3 pair compatibility, verification
policies, error messages and returned buffer ownership are preserved.

| Minified ESM | Before | Default now | With `--compact-hash` |
| --- | ---: | ---: | ---: |
| Recommended: pair | 10,247 B | 9,624 B | 8,488 B |
| Recommended full: pair + ANS | 11,147 B | 10,528 B | 9,484 B |
| Complete full | 16,589 B | 15,980 B | 14,816 B |

These sizes include the embedded gzip/base64 Wasm and loader. The default
reductions are 6.1%, 5.6% and 3.7%; the compact builds reduce the old sizes by
17.2%, 14.9% and 10.7%. Recommended profiles retain fixed BLAKE3 and format
verification. Compact hashing is the same BLAKE3-256 algorithm and digest size;
it changes scalar code generation, not integrity strength or validation.

## Retained changes

- Error construction is shared across preflight, warm-up and decode. Builds
  still remove messages for omitted verification modes. Warm-up reads each
  supplied codec once and uses a smaller generated selector.
- Unicode lookup initialization fills seven contiguous ranges. A shared,
  non-inlined fill loop avoids seven specialized copies and allows SIMD stores.
  The alphabet and invalid holes are unchanged. Native encoding reserves its
  exact alphabet capacity before extending those same ranges.
- Pair-only kernels use Binaryen O3; broader kernels retain O4. The chosen
  defaults keep expanded scalar BLAKE3 rounds and four-chunk SIMD hashing.
- `--compact-hash` selects one scalar round body with fixed message positions
  and the standard BLAKE3 permutation. Four-chunk SIMD is retained when enabled.
  The expanded scalar implementation is absent from that decoder. The flag is
  removed when BLAKE3 verification is not built, and adds no JavaScript option.

```sh
# Normal recommended profiles remain speed-oriented.
glyphpack build -o recommended.mjs
glyphpack build --packing pair ans -o recommended-full.mjs

# Explicitly choose smaller BLAKE3 code.
glyphpack build --compact-hash -o smaller.mjs
glyphpack build --packing pair ans --compact-hash -o smaller-pair-ans.mjs
glyphpack build --full --compact-hash -o smaller-full.mjs
```

The compact version has a real throughput tradeoff on some payloads, so it is
not the default. `--all` writes the standard profiles; request compact builds
individually. Native encoders retain their expanded hash implementation.

## Fresh measurements

The secure comparison uses three fresh processes per browser, nine measured
batches, rotated order, and 1 KiB / 64 KiB / 1 MiB / 10 MiB deterministic inputs.
It covers every codec in all three profiles. The full-module follow-up measures
all twelve integrity/format/memory policies in Chromium 156.0.8078.79. Chrome
109.0.5414.119 is also measured in the secure comparison and tested for compatibility.

On this unpinned Linux aarch64 host, median lookup warm-up improved **2.6–3.2×**
across the profiles and browsers. This measures the warm-up export on fresh
instances; module decompression, compilation and instantiation are excluded.
It is not a claim about complete page startup. Default steady decoding remains
workload-dependent; the CSVs include slower cases and run-to-run variability.

The timer includes input transfer, decoding, selected verification, and a fresh
owned output. Encoding, file reads, imports and byte validation are excluded.
Small-input entry points are preheated for 10,000 calls; other cases receive
four warm calls after validation. Warm-up measurements use nine batches of
eight fresh instances. COOP/COEP improves timer resolution only; product code
does not require isolation, shared memory or threads. Offline tests run without it.

[Secure decoding and raw batches](../benchmarks/results/decoder-optimization/decode.csv),
[all 12 policies](../benchmarks/results/decoder-optimization/policies.csv),
[lookup warm-up](../benchmarks/results/decoder-optimization/warmup.csv), and
[environment/artifact hashes](../benchmarks/results/decoder-optimization/environment.json).
The short [size summary](../benchmarks/results/decoder-optimization/sizes.csv)
and [warm-up summary](../benchmarks/results/decoder-optimization/warmup-summary.csv)
are available separately from the raw samples.

## Rejected candidates and reproduction

Testing also covered raw LLVM output, Binaryen O2/O3/O4/Os/Oz, row-oriented SIMD
hashing, several loop/unroll schedules, four-state ANS batching, and alternative
JS input copies. Smaller hash variants sometimes slowed small payloads; batching
and copy changes had inconsistent or worse throughput. Those were not adopted.
The rejected batching patch is retained under
`benchmarks/experiments/decoder-optimization/` for inspection.

From a checkout with the recorded baseline commit and the documented build tools:

```sh
node benchmarks/baseline.cjs 6214588
cargo run --release --locked --example codec_bench
OPT_LEVELS=baseline cargo run --release --locked --example optimize_decoder -- default-
OPT_LEVELS=baseline OPT_COMPACT=1 cargo run --release --locked --example optimize_decoder -- compact-
OPT_VARIANTS=baseline,default-baseline,compact-baseline OPT_RUNS=3 OPT_ROUNDS=9 OPT_LABEL=retained node benchmarks/optimize.cjs
CHROMIUM109_BIN=/not-installed OPT_WARMUP=0 OPT_PROFILE=full OPT_ALL_POLICIES=1 OPT_VARIANTS=baseline,default-baseline,compact-baseline OPT_ROUNDS=9 OPT_LABEL=all-policies node benchmarks/optimize.cjs
node benchmarks/optimization-report.cjs
```

`CHROMIUM_BIN` and `CHROMIUM109_BIN` select the installed browsers. The old
distributions are extracted from Git rather than rebuilt with today's toolchain.
The native example can screen additional compiler passes by omitting `OPT_LEVELS`.
