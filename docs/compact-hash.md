# Compact versus expanded BLAKE3 speed

Fresh local tests compare the same production Rust hash source with compact
scalar rounds and expanded scalar rounds. Both keep the four-chunk SIMD path
and produce identical BLAKE3-256 digests. No production implementation changed
during this comparison.

Hashing alone, Chromium 156.0.8078.79 on Linux aarch64:

| Input | Expanded | Compact | Compact extra time |
| --- | ---: | ---: | ---: |
| 64 B | 0.491 µs | 0.504 µs | +2.6% |
| 1 KiB | 2.655 µs | 2.935 µs | +10.5% |
| 4 KiB | 10.075 µs | 11.145 µs | +10.6% |
| 16 KiB | 33.950 µs | 35.400 µs | +4.3% |
| 64 KiB | 129.950 µs | 132.200 µs | +1.7% |
| 1 MiB | 2.058 ms | 2.076 ms | +0.9% |
| 10 MiB | 20.600 ms | 20.810 ms | +1.0% |

Small inputs use the scalar compressor throughout. For larger inputs, most work
uses the unchanged SIMD implementation; compact scalar rounds handle remaining
chunks and tree parents. The current SIMD prefix loop deliberately leaves the
final one to four chunks scalar, so an exact 4 KiB input still uses scalar rounds.

The separate **complete Pair decode** test uses the actual recommended ESM
modules, fixed BLAKE3 and format verification, and memory-heavy optimization off.
Times include the input copy, decoding, verification and a fresh owned output:

| Input | Expanded build | Compact build | Compact extra time |
| --- | ---: | ---: | ---: |
| 1 KiB | 7.156 µs | 7.394 µs | +3.3% |
| 64 KiB | 0.2483 ms | 0.2494 ms | +0.5% |
| 1 MiB | 4.0217 ms | 3.9867 ms | −0.9% |
| 10 MiB | 39.990 ms | 40.415 ms | +1.1% |

The sub-percent reversal at 1 MiB is within observed run variation; it does not
establish a compact-mode speedup. Earlier shorter batches had substantial GC
spikes at 1 KiB. The final comparison uses 10,000 decodes per small-input batch
to make that noise less influential. It still measures allocations and GC.

Chrome 109.0.5414.119 shows the same broad pattern: compact hashing alone takes
15–17% more time at 1–4 KiB and 2–3% more time at 64 KiB–10 MiB. Complete Pair
decoding takes 10.7% more time at 1 KiB and differs by at most 0.3% at the larger
tested sizes. Raw results retain a slower hash-only process on Chrome 109;
the summary uses the median of three process medians rather than discarding it.

For a size-sensitive application that decodes a few large embedded assets,
compact hashing is a useful tradeoff. Keep expanded rounds when many small
payloads are on a hot path. Results depend on the browser and CPU.

## Method and data

- Three fresh processes per browser and implementation pair; execution order
  rotates within each round. The Linux host is not CPU-pinned.
- Hash-only: nine batches; bytes already reside in Wasm memory. Each timed call
  computes and writes all 32 digest bytes; the caller consumes one byte. Copies,
  module loading, compilation, input preparation and answer checks are excluded.
  Both harnesses use Rust opt-level 3, fat LTO, SIMD128 and Binaryen O3.
- Complete decode: fifteen batches of 10,000 / 40 / 3 / 1 calls for 1 KiB /
  64 KiB / 1 MiB / 10 MiB. Ten thousand small-input warm calls and four warm
  calls at other sizes precede measurement. Imports, I/O and byte comparisons
  are excluded. Deterministic random input and both exact module hashes are
  recorded.
- Every hash harness checks all 35 official BLAKE3 test vectors, comparing the
  entire 32-byte digest before timing. Every decoded fixture is byte-checked.
- COOP/COEP improves timer resolution only; the runtime requires neither shared
  memory nor cross-origin isolation.

[Compact summary CSV](../benchmarks/results/compact-hash/summary.csv),
[hash-only samples](../benchmarks/results/compact-hash/hash.csv),
[hash environment and raw data](../benchmarks/results/compact-hash/hash.json),
[decode samples](../benchmarks/results/compact-hash/decode.csv), and
[decode environment and raw data](../benchmarks/results/compact-hash/decode.json).
All summary times are medians of three process medians. Extra time is
`100 * (compact / expanded - 1)`, not a throughput percentage.

Reproduce after preparing the candidate builds and deterministic fixtures in
[the optimization report](decoder-optimization.md):

```sh
node benchmarks/compact-hash.cjs
OPT_PROFILE=recommended OPT_VARIANTS=default-baseline,compact-baseline OPT_RUNS=3 OPT_ROUNDS=15 OPT_SMALL_BATCH=10000 OPT_LABEL=compact-check-long OPT_WARMUP=0 node benchmarks/optimize.cjs
node benchmarks/compact-hash-report.cjs
```

`CHROMIUM_BIN` and `CHROMIUM109_BIN` select the installed browser binaries.
`HASH_RUNS` and `HASH_ROUNDS` customize the isolated-hash campaign. Source hashes,
tool versions and actual browser versions are recorded alongside the samples.
