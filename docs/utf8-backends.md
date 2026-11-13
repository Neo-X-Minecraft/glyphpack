# UTF-8 backend selection for Chromium 156

The delivered `utf8-raw` module contains **one JavaScript decoder**, selected on
Chromium 156.0.8078.79. Wasm is used only if it makes the complete decode faster;
none of the successful Wasm/hybrid candidates won here. Chrome 109 remains a
compatibility requirement, without influencing the performance choice.

The current [matched report](../benchmarks/results/utf8-rival/report.md) records
3.305 ms for random 1 MiB input, versus 3.608 ms for the previous exact module,
3.490 ms for the tuned Base122 loop, 5.995 ms for the upstream-derived reference,
and 4.263 ms for the fastest Wasm finalist. That is 8.4% less decode time than
the previous build and 5.3% less than tuned Base122 on this fixture. This is one
host, not proof of the globally fastest decoder or performance on every device.

The same selected implementation wins the six final fixtures: random 1 KiB,
64 KiB and 1 MiB, zero-filled 1 MiB, sequential 1 MiB and repeated public text.
No input-specific dispatch, size threshold, engine sniff or runtime calibration
is shipped. All timing includes fresh exact output allocation and validation.

## Selected change

The old 4 KiB lookup attached a validity bit to every entry and masked it off
for every decoded symbol. The new `Int16Array(2048)` stores valid 15-bit data
directly and uses **-1 for invalid entries**. Zero remains a valid data value.
OR accumulates invalid sign bits; `table[code] ?? -1` also rejects every UTF-16
unit beyond the table. No validity-bit mask is needed in the hot loop. Bounds, length,
padding, character checks, API and exact error messages are preserved.

This reduces the delivered ESM from **2,342 to 2,319 bytes**. A 1 MiB complete
UTF-8 HTML file is **1,193,203 bytes**, 5,578 bytes below the smallest tested
Base122 HTML. Payload expansion remains 13.5593% asymptotically for independent
uniform random bytes, versus Base122's 14.2857%.

A 128 KiB full-code-unit table removes the out-of-range sentinel expression,
but did not justify its extra memory against the 4 KiB table. The selected
loop retains its output-space guard, so valid padding never triggers an ignored
out-of-bounds store. Replacing that guard with a final-symbol condition, allowing
speculative tail stores, two-symbol ASCII lookup, branch-free byte stores and
DataView 16-bit stores did not provide a better overall result.

## Wasm and hybrid search

The Rust prototype builds 21 scalar configurations:

| Input staging | Kernel / copying variants | Count |
| --- | --- | ---: |
| Native `TextEncoder.encodeInto` UTF-8 | Scalar, fixed-phase unroll, ASCII block, branch-free unroll, high queue | 5 |
| Copied UTF-16 | Scalar, unroll, branch-free, high queue; each with scalar, eight-unit or paired-32-bit copying | 12 |
| JS lookup into 16-bit tokens | Scalar, unroll, branch-free, high queue | 4 |

Each module imports fresh unshared memory, creates its lookup once, reuses
geometrically sized arenas and returns an exact owned copy. UTF-16 copying and
token translation are counted. Native UTF-8 conversion is counted. Wasm is
actually executed; these candidates contain no JavaScript decoding fallback.
All 21 pass the 1,600 native vectors; all are screened in Chromium 156. The two
most promising scalar/hybrid finalists are repeated alongside the selected JS,
previous exact module and Base122 competitors in the final campaign.

One additional token/SIMD prototype computes eight symbol products and uses a
256-entry permutation table to compact the optional bytes. It passes 1,600
vectors and the random 1 MiB output hash under Node 24.21.0, but crashes the
Chromium renderer during the browser check. It is excluded and has no accepted
browser timing. The cause is unresolved: this is not a claim that Chrome lacks
SIMD support. Build it only with `--simd`; ordinary preparation excludes it.

Wasm kernels and adapters are research code under `benchmarks/`; they are not
imported by `src/`, embedded in `dist/`, or installed as runtime dependencies.
The smaller JS module avoids a Wasm loader, cold compilation, input staging and
the extra output copy. Production pair/ANS/Windows codecs continue to use their
existing Rust/Wasm implementation; this decision concerns only raw UTF-8 `~u2`.

## Evidence and reproduction

The final campaign uses three fresh Chromium processes and nine rotated batches
per input. Each table entry is a median of process medians; ranges and every
batch remain available. Browser launch, import, string transfer, encoder work,
HTML parsing and output hashing are outside warm timing. Allocation, header,
body, unmasking, staging and final copying are inside it. Correctness probes
that use malformed data run in separate processes, preserving timing feedback.
Each small-input batch contains 1,000 calls for inputs at most 1 KiB, 20 calls
through 64 KiB, and two calls for larger inputs; samples are per-call averages.
The aggregate CSV retains those batch sizes and microsecond-scale precision.

```sh
cargo run --release --locked -- build --all
cargo run --release --locked -- bench prepare --quick
cargo run --release --locked --example utf8_raw_fixtures
cargo build --release --locked --example utf8_raw
node benchmarks/utf8-rival-verify.cjs
node benchmarks/utf8-wasm-prepare.cjs
node benchmarks/utf8-wasm-check.cjs
RIVAL_BROWSER=current RIVAL_EXTRA_MANIFEST=generated/utf8-wasm/builds.json \
  RIVAL_RUNS=3 RIVAL_ROUNDS=9 RIVAL_LABEL=final \
  RIVAL_VARIANTS=utf8-raw,utf8-previous,utf8-unroll,base122-groupUnroll,base122-block122,base122-reference,wasm-utf16-branchless-copy1,wasm-tokens-unroll \
  node benchmarks/utf8-rival.cjs
node benchmarks/utf8-rival-report.cjs
```

Both Chrome 109 and 156 pass exhaustive comparisons for every UTF-16 code unit
in two packet contexts (131,072 cases), 10,000 bounded random mutations, 1,600
valid vectors including all masks, existing rejection cases, NFC alphabet
pairs, exact buffer lifetime and nine offline HTML pages including 10 MiB.
Wasm, decompression streams and network access are disabled in the file tests.

- [Compact CSV](../benchmarks/results/utf8-rival/summary.csv).
- [All final aggregated comparisons](../benchmarks/results/utf8-rival/decode.csv).
- [Every final batch and module hash](../benchmarks/results/utf8-rival/final.json).
- [All 21 scalar Wasm/hybrid candidates](../benchmarks/results/utf8-rival/wasm-complete-screen.json).
- [Node kernel correctness](../benchmarks/results/utf8-rival/wasm-correctness.json)
  and [excluded SIMD diagnostic](../benchmarks/results/utf8-rival/simd-diagnostic.json).
- [Earlier matched artifact campaign](../benchmarks/results/utf8-rival/initial-final.json)
  and [its compatibility hashes](../benchmarks/results/utf8-rival/compatibility-initial.json).
- [Current compatibility record](../benchmarks/results/utf8-rival/compatibility.json).

Screen files describe separate evolving prototypes and must not be pooled with
the final samples. `baseline.min.mjs` is the frozen prior delivered module;
`model.mjs` under the experiment directory freezes the earlier sign-bit rules,
so historical loops do not silently acquire the selected sentinel semantics.

The optional diagnostic is reproduced with
`node benchmarks/utf8-wasm-prepare.cjs --simd` followed by
`node benchmarks/utf8-wasm-check.cjs --simd`. It records an excluded result when
the renderer crashes; it does not assign a successful decode time to that run.
