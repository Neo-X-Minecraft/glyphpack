# Local five-codec integration measurements

Recorded 2026-11-13T20:34:48.356Z on 156.0.8078.79, arm64.
Three fresh Chromium processes; 9 rotated measured rounds per
ordinary variant, two calls per batch. Compact uses three single-call rounds per
process because each call takes about two seconds. Values below are medians of
the per-process medians. The CSV retains each process's median range; the JSON
retains all samples, artifact hashes, input hash and timing scope. No CPU pinning
or cross-device performance guarantee is implied.

All variants recover the same 1,048,576 deterministic pseudorandom
bytes, verified by SHA-256 outside timing. Encoding, import, warm-up and digest
comparison of the benchmark output are excluded. Calls include fresh output
allocation, dispatch, JS/Wasm staging, requested integrity and output copying.
None mode still checks format except the explicitly unchecked/core variants.
The tuned Base122 peer is permissive and returns a view over an oversized
buffer; GlyphPack includes strict structural checks and exact output allocation.

## Native-source density and complete full-module calls

Payload sizes include codec framing and mask/length headers, excluding the
module and HTML shell. Source bytes use each codec's intended charset; these
numbers are not the size of a document mixing all five logical strings.
BLAKE3 timing uses separately encoded secure packets, including their trailer.

| Codec | Native payload bytes (none) | Expansion | Full, none (ms) | Full, BLAKE3 (ms) |
| --- | ---: | ---: | ---: | ---: |
| pair | 1,052,854 | 0.408% | 2.287 | 3.503 |
| ans | 1,051,766 | 0.304% | 2.067 | 3.358 |
| windows | 1,050,083 | 0.144% | 3.472 | 4.708 |
| utf8 | 1,190,792 | 13.563% | 3.345 | 4.620 |
| utf8-compact | 1,171,980 | 11.769% | 2071.335 | 2076.595 |
| Tuned Base122 (UTF-8) | 1,198,373 | 14.286% | 3.465 | — |

Fast UTF-8 saves 7,581 payload bytes
against Base122 on this input. Compact UTF-8 saves
18,812 more bytes,
but is hundreds of times slower. Its fixed 4 KiB block enumeration is a
size-first choice, not a suggested default. These are binary-to-text transports;
compress redundant input separately when useful.

## Fast UTF-8 integration cost

| Call | Median ms |
| --- | ---: |
| previous-raw | 3.392 |
| current-raw | 3.400 |
| utf8-core | 3.240 |
| utf8-strict-js | 3.400 |
| utf8-secure-fixed | 4.948 |
| utf8-none | 3.345 |
| utf8-secure | 4.620 |
| utf8-unchecked | 3.367 |
| base122-tuned | 3.465 |

The original 2,319-byte selected decoder is frozen under experiments, rather
than reconstructed from later sources. Current raw and fixed strict adapters
remain competitive with it and tuned Base122. The integrated decoder reads the
original framed string directly instead of slicing its large body. Multi-policy
builds accumulate the cheap validity sign without branching for every symbol,
then apply the requested policy once at the end. Fixed unchecked builds erase
that accumulator. No data-dependent backend or runtime benchmarking is shipped.
The selected fast unpacker is JavaScript; the earlier Wasm/hybrid search did not
beat it. Integrity verification shares the existing Rust/Wasm implementation.

## Current complete module sizes

| Module | Bytes |
| --- | ---: |
| default.min.mjs | 9,725 |
| recommended-full.min.mjs | 10,625 |
| utf8.min.mjs | 10,155 |
| utf8-compact.min.mjs | 12,312 |
| utf8-raw.min.mjs | 2,365 |
| full.min.mjs | 21,794 |

The full ESM embeds 28,789 Wasm bytes compressed
to 10,355 gzip bytes and
13,808 base64 characters. These are already
included in its 21,794-byte module size.
It supports all five transports, three integrity policies, both format policies,
and both pair lookup policies. Defaults remain strict BLAKE3, memory false.
Compact BLAKE3 scalar code is a separate build flag, not the compact UTF-8 codec.

## Validation

All 31 nonempty codec subsets plus eight extra specialized builds passed
53,613 Node comparisons and 441 expected rejections. Each of Chrome
109.0.5414.119 and Chromium 156.0.8078.79 passed 14,467 comparisons, 4,989
expected rejections, ten 1 MiB cases and six actual offline HTML documents.
Three additional hostile HTML cases per browser verify closing textarea/script,
legacy script comments, mixed case and natural guard runs. No offline network
requests occurred. The separate raw compatibility campaign also passed both
browser versions, all 65,536 UTF-16 unit substitutions, controlled mutations and
normalization checks. Existing pair/ANS/Windows, BLAKE3 reference, package,
TypeScript and 60-case workbench tests pass separately.

- [Compact CSV](summary.csv), [all timing samples](decode.json).
- [Integration compatibility](compatibility.json), [raw compatibility](raw-compatibility.json).
- [Exact API, framing and builder integration](../../../docs/integration.md).

Reproduce from a configured checkout:

```sh
cargo run --release --locked -- build --all
cargo run --release --locked --example integration
node tests/integration.cjs
node tests/integration-browser.cjs
node tests/integration-html.cjs
node benchmarks/integration.cjs
node benchmarks/integration-report.cjs
```
