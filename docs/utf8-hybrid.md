# JS/Wasm hybrid decoder search

This extends the raw UTF-8 prefix experiment, without changing its wire format,
mandatory validation or owned output buffers. Production GlyphPack formats and
verification defaults remain unchanged. The raw prefix transport has no digest.

**Keep the existing JS throughput default for general warm decoding.** The new
Wasm candidates offer some workload-specific gains, at larger bundle sizes.

## Matched warm results

Linux aarch64, same 1 MiB inputs, three fresh processes per browser and nine
rotated measured batches per input. Times include headers, validation, input
conversion/staging, Wasm calls, unmasking, allocation and the final output copy.

| Input / browser | JS default | JS balanced | Stateless Wasm words | Wasm native UTF-8 | Wasm JS string builtins |
| --- | ---: | ---: | ---: | ---: | ---: |
| Random, Chromium 156 | **4.795 ms** | 6.002 ms | 6.043 ms | 8.667 ms | 9.032 ms |
| Zeros, Chromium 156 | 3.185 ms | 3.582 ms | **3.013 ms** | 3.803 ms | 4.230 ms |
| Random, Chrome 109 | 8.907 ms | **6.460 ms** | 7.015 ms | 9.340 ms | JS fallback |
| Zeros, Chrome 109 | 5.063 ms | 4.127 ms | **3.542 ms** | 4.410 ms | JS fallback |

The stateless words variant saves 5.4% on the zero-filled fixture in Chromium
156, but takes 26.0% more time on the random fixture. In Chrome 109 it saves
14.2% on zeros relative to balanced JS, while taking 8.6% more time on random
data. These synthetic cases establish a tradeoff, not a general win for Wasm.
Compressible input also often benefits more from compression than faster raw
transport decoding; no compression speed claim is made here.

## First load and file size

Cold runs use a fresh browser process for every module/input pair, with no
earlier calls or warm-up. The timer includes data-URL module loading and its
Wasm compilation/instantiation, then the first decode of an already resident
string. Browser startup, input transfer, HTML parsing and the subsequent output
hash check are excluded. Three processes per case retain their individual data.

| 1 MiB first load | JS default | JS balanced | Stateless Wasm native UTF-8 |
| --- | ---: | ---: | ---: |
| Chromium 156 | 32.930 ms | **18.685 ms** | 25.670 ms |
| Chrome 109 | 42.900 ms | 28.960 ms | **23.210 ms** |

The UTF-8 hybrid saves 19.9% against balanced JS in this Chrome 109 first-load
case. It loses against balanced JS in Chromium 156. These are resident-string
import/decode measurements, not browser page-load benchmarks. The host is not
CPU-pinned; process ranges are preserved in the CSV, and cold measurements have
more variation than the warm batches.

| Bundle | Wasm core | Complete ESM | Gzip core + native decompression ESM |
| --- | ---: | ---: | ---: |
| Current JS default | — | **1,777 B** | — |
| Stateless Wasm words | **292 B** | 3,074 B | 3,126 B |
| Stateless Wasm UTF-8 | 371 B | 3,305 B | 3,337 B |
| Chunked Wasm words, scalar, 4 KiB | 804 B | 3,710 B | 3,466 B |

The complete hybrid includes the existing JS fallback, shared header/alphabet
logic and its loader. Native `gzip -9n` makes the larger core's bundle smaller,
but loses overall for the tiny cores once the decompression loader is counted.
No gzip wrapper was timed as if it were the raw wrapper; these are size-only
comparisons. Representative gzip files also pass offline/fallback verification.
The existing JS build remains the compact choice. Its earlier complete HTML
advantage over Base122 must not be attributed to these larger experimental files.

## What was tested

The build matrix contains **52 additional configurations**: 51 ordinary hybrid
variants and one eagerly primed variant. The ordinary variants comprise:

- Four input representations: native UTF-8, copied UTF-16, JS-translated 32-bit
  descriptors and 16-bit sentinel tokens.
- Three stateful kernels per representation: ordinary reservoir, high-aligned
  speculative stores and eight-symbol bulk decoding. Each runs with whole-input,
  4 KiB and 32 KiB staging, for 36 configurations.
- Six stateless scalar/high-aligned kernels with imported JS-owned memory,
  plus a complete 2 MiB finite-state table and two tighter ASCII bulk kernels.
- Six direct-string configurations, using ordinary/high-aligned queues,
  native string length or one initial string cast.

Chunking bounds input staging rather than adding a streaming API: the public
decode call is synchronous and still returns a complete owned buffer. For
32-bit words, a 4 KiB character chunk uses 16 KiB of input staging. Output memory
remains proportional to input size. Native kernels are specialized at build
time; the delivered experiment contains one selected kernel, not this matrix.

The string path uses the standard [JS string builtins proposal](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md).
It avoids input copying and really executes Wasm in Chromium 156; Chrome 109
fails that capability check and uses the existing JS implementation. Both
backends pass the same output/error comparisons. Despite avoiding the copy, the
direct-string variants remain slower here. Casting once did not reverse that
result. A 32,768-call priming test and a separate requested optimizing-only V8
flag run also failed to produce a useful improvement; that engine flag is a
diagnostic, not a deployment requirement.

Previous SIMD attempts, including a small smoke attempt, crashed this renderer.
They provide no usable timing and do not establish that browsers lack SIMD.
All successfully measured kernels here use scalar Wasm. No worker/parallel
decoder or asynchronous streaming API was implemented in this study.

## Correctness and reproducibility

Every ordinary candidate passes 720 valid portable packets and 1,000 bounded
malformed-input comparisons per browser against the existing JS decoder, with
exact error messages. Separate test processes keep malformed probes out of the
timing processes. Each timing fixture is hash-checked outside the timer.

Additional verification passes **30 offline `file://` pages** and **336 long-input
error comparisons** across 4/32/64 KiB boundaries. It checks native execution,
JS fallback with Wasm/decompression disabled, gzip fallback, fresh output
ownership and zero runtime HTTP requests. The tested browsers are Chromium
156.0.8078.79 and Chrome 109.0.5414.119. Other engines and CPU architectures were
not measured. String-builtin results on Chrome 109 are explicitly labeled JS.

The existing recommended builds and defaults are unchanged. To inspect the
experimental native UTF-8 module after preparation, use
`generated/utf8-hybrid/decoder-hybrid.min.mjs`; `decoder-words.min.mjs` selects
the stateless words kernel. Both are standalone ESM files with automatic JS
fallback and `decode`/`warmup` exports. They are research artifacts, not package
exports or new production format choices.

```sh
source .tools/env.sh
# Prepare standard public inputs and the existing prefix modules first:
node benchmarks/utf8-speed-prepare.cjs
node benchmarks/utf8-hybrid-prepare.cjs

SPEED_VARIANTS=delivered,balanced,hybrid-words-scalar-4096,hybrid-words-high-4096,stateless-words-scalar,stateless-utf8-high,string-length SPEED_ALLOW_FALLBACK=1 SPEED_OUT=benchmarks/results/utf8-hybrid SPEED_LABEL=selected SPEED_RUNS=3 SPEED_ROUNDS=9 node benchmarks/utf8-speed.cjs
node benchmarks/utf8-hybrid-cold.cjs
node benchmarks/utf8-hybrid-verify.cjs
```

See [the experiment instructions](../benchmarks/experiments/utf8/hybrid/README.md)
for the complete matrix and report commands. The report verifies that rebuilt
artifacts match the measured SHA-256 values before producing summaries.

[Four-row CSV](../benchmarks/results/utf8-hybrid/comparison.csv),
[all selected warm cases](../benchmarks/results/utf8-hybrid/warm.csv),
[cold cases and process ranges](../benchmarks/results/utf8-hybrid/cold.csv),
[all decode samples](../benchmarks/results/utf8-hybrid/decode.csv),
[raw/gzip sizes](../benchmarks/results/utf8-hybrid/sizes.csv), and
[offline/boundary verification](../benchmarks/results/utf8-hybrid/compatibility.json).
