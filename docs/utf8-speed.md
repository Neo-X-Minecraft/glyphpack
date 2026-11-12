# UTF-8 decoder optimization search

This concerns the separate raw UTF-8 prefix experiment. It preserves version-1
packets, exact error messages, format validation and fresh, exactly sized output
buffers. It does not alter GlyphPack's production formats or BLAKE3 defaults.
The raw transport itself has no integrity digest.

## Selected builds

The native example now defaults to a throughput loop for current Chromium.
`--balanced` selects a smaller-state loop that performs better in Chrome 109.
Selection happens when building: each delivered file contains one loop, one
8 KiB table and no engine detection or runtime benchmark.

Matched 1 MiB random-input measurements, Linux aarch64:

| Build | ESM bytes | Chromium 156 | Chrome 109 |
| --- | ---: | ---: | ---: |
| Previous exact artifact | 2,154 | 5.298 ms | 7.525–15.433 ms process range |
| Default throughput | **1,777** | **4.788 ms** | 7.960 ms |
| `--balanced` | 1,781 | 5.623 ms | **6.228 ms** |

Default decode time is 9.6% lower on this Chromium 156 fixture, with a 17.5%
smaller module. This is not a universal speedup: the zero-filled 1 MiB fixture
takes 3.155 ms versus the previous 3.010 ms. The balanced build is 21.8% faster
than throughput in Chrome 109 on random 1 MiB input. The older browser shows
substantial process spread for some artifacts; the CSV includes process ranges
and raw samples instead of presenting its baseline median as a reliable 2× win.

The classic default build is 1,798 bytes; the all-profile ESM is 1,951 bytes.
The auto-masked packet remains 1,195,864 bytes. Complete 1 MiB standalone HTML
is **1,197,759 bytes**, including decoder, BOM, metadata and payload: 1,022 bytes
below the smallest tested Base122 HTML. This small saving does not mean every
possible input or small complete document beats Base122.

```sh
source .tools/env.sh
cargo run --release --locked --example utf8_prefix -- build decoder.mjs
cargo run --release --locked --example utf8_prefix -- build balanced.mjs --balanced
cargo run --release --locked --example utf8_prefix -- html input.bin output.html
cargo run --release --locked --example utf8_prefix -- html input.bin balanced.html --balanced
```

## What changed

The throughput loop keeps live bits at the high end of a 32-bit register.
It writes the next byte speculatively and advances by the actual number of
complete bytes. Unfinished stores are overwritten; typed-array stores beyond
the declared output are ignored. Final length and padding checks independently
reject truncated, excess and nonzero padding data. All symbols are checked.
The queue never contains more than 22 live bits, so no BigInt or double queue
is needed.

The balanced loop keeps the previous low-aligned queue. Table entries carry a
validity flag, accumulated with AND and tested after the loop. This removes the
per-symbol rejection branch without adding another table or skipping character
validation. Header allocation guards still run first; invalid-character errors
still precede final length/padding errors.

The fixed 37 alphabet ranges are stored as a small delta string rather than
37 nested arrays. It reconstructs exactly the same alphabet. Header error text
is shared on cold error paths. No payload alphabet or header field changed.

## Search and limits

The final screen measures **19 variants** on both browser versions, using
random 1 KiB/64 KiB/1 MiB, zero-filled 1 MiB and sequential 1 MiB public inputs.
It covers speculative writes, DataView stores, split width/value tables,
sentinel/CLZ tables, 64 KiB/2 MiB state tables, a full UTF-16 lookup table,
explicit lookup bounds, ASCII pairs, two ASCII-store strategies, 4/6 KiB models,
and a Rust/Wasm kernel filled through native `TextEncoder.encodeInto`.

Large transition tables did not justify their memory. Smaller tables, block
loops and unaligned DataView stores did not consistently beat the selected
loops. Converting the string to UTF-8 before decoding it in JS loses time.
Native conversion into Wasm improves some patterns but still includes a full
string conversion and output copy, and its embedded module is much larger.
The benchmark-only SIMD kernel passes 720 Node byte comparisons, but twice
crashed this Chromium 156 renderer; it has no accepted browser timing and is
excluded from delivered builds. That is an observation about this environment,
not a claim that Chrome lacks SIMD support.

Streaming and worker parallelism were not implemented or measured. Streaming
could lower working memory or improve responsiveness for much larger inputs;
these measurements do not establish a throughput benefit for either approach.

## Evidence

The selected campaign uses three fresh browser processes per version and nine
rotated measured batches per fixture. Candidate order also rotates between
processes. The broad screen uses one process and five batches, so its absolute
times are not interchangeable with the selected campaign. Correctness/fuzzing
uses entirely separate browser processes to avoid contaminating timing feedback.
Warm timers include validation, allocation, unmasking, native conversions and
Wasm copies. SHA-256 output checks are outside timing. ESM loading is outside
warm timing; data-URL import and first 1 KiB decode are recorded separately.
The host is not CPU-pinned, and other engines/devices remain unmeasured.

Every screened decoder passes 720 portable cases per browser and 1,000 bounded
malformed-input comparisons against the previous exact artifact. Delivered
builds additionally pass 5,040 valid cases, 309 rejection cases, 13 offline
pages per browser and all 2,748,964 ordered alphabet pairs under NFC. Both
Chromium 156.0.8078.79 and Chrome 109.0.5414.119 load `file://` HTML with Wasm,
decompression and runtime network access disabled, including 1 MiB and 10 MiB
native HTML. The [compatibility record](../benchmarks/results/utf8-speed/compatibility.json)
contains exact artifact hashes and deliberately mislabelled HTTP tests.

[Six-row comparison CSV](../benchmarks/results/utf8-speed/summary.csv),
[candidate comparison CSV](../benchmarks/results/utf8-speed/candidates.csv),
[all decode samples](../benchmarks/results/utf8-speed/decode.csv),
[selected environment and samples](../benchmarks/results/utf8-speed/selected.json),
and [screen environment and samples](../benchmarks/results/utf8-speed/search.json).
The [reproduction instructions](../benchmarks/experiments/utf8/speed/README.md)
identify every source, including the frozen historical baseline.
