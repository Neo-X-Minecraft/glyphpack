# UTF-8 versus Base122

Recorded 2026-11-13T17:40:51.614Z; arm64, unknown.

The selected UTF-8 decoder is **2,319 bytes**, with a 4 KiB lazy table. It returns validated, owned, exactly sized output. The Base122 competitors keep their unchecked/view-returning policies. Neither side computes a digest.

## Complete standalone file size

Identical 1 MiB synthetic random bytes; actual UTF-8 files with BOM, metadata, decoder, container escaping and payload:

| Implementation | Complete HTML bytes |
| --- | ---: |
| native-zero | 1,193,203 |
| base122-reference | 1,198,781 |
| base122-groupUnroll | 1,199,801 |

Payload alone: 1,190,768 bytes for UTF-8 raw and 1,198,373 for Base122. Expected asymptotic uniform-random overhead is 13.5593% versus 14.2857%. These are measured file sizes, not compressed download sizes or string code units. Small payloads may favor Base122 because its smallest decoder is smaller.

## Complete warm decode

Milliseconds per full call: allocation, header, body, XOR and mandatory structural checks are included. Import/HTML parse/encoding/output verification are outside the timer. Each entry is the median of 3 independent process medians, each based on 9 rotated batches. The table selects the fastest tested Base122 candidate separately per input/browser; this favors the competitor and is not one adaptive Base122 implementation. Positive difference means UTF-8 raw took longer.

| Chrome | Input | UTF-8 raw ms | Fastest Base122 ms | Base122 loop | Time difference |
| --- | --- | ---: | ---: | --- | ---: |
| 156 | bootstrap | 0.040 | 0.045 | groupUnroll | -11.1% |
| 156 | random-1KiB | 0.003470 | 0.004430 | groupUnroll | -21.7% |
| 156 | random-64KiB | 0.185 | 0.198 | groupUnroll | -6.5% |
| 156 | random-1MiB | 3.305 | 3.490 | groupUnroll | -5.3% |
| 156 | zeros-1MiB | 1.692 | 2.880 | groupUnroll | -41.2% |
| 156 | sequential-1MiB | 2.820 | 2.935 | groupUnroll | -3.9% |

The group-unrolled Base122 candidate applies this format's main constant-shift insight to Base122 too. Comparing only with the slower historical baseline would overstate the gain. The result is a size advantage at competitive decode speed, not a universal speed record. Zero/sequential/ASCII fixtures can favor different loops; the same UTF-8 implementation is used throughout.

## One selected implementation

Performance selection targets **Chromium 156.0.8078.79**. Chrome 109 remains a compatibility check, not a performance target. The shipped decoder contains one 4 KiB-table JavaScript implementation, with no Wasm, backend selection, runtime benchmarking or fallback code.

| Random 1 MiB, complete call | Median ms | Process median range ms | ESM bytes |
| --- | ---: | ---: | ---: |
| utf8-previous | 3.608 | 3.538–3.625 | 2,342 |
| utf8-raw | 3.305 | 3.270–3.315 | 2,319 |
| utf8-unroll | 3.355 | 3.347–3.375 | 2,311 |
| base122-block122 | 4.508 | 4.502–4.540 | 848 |
| base122-reference | 5.995 | 5.970–6.015 | 305 |
| base122-groupUnroll | 3.490 | 3.485–3.510 | 1,325 |
| wasm-utf16-branchless-copy1 | 4.320 | 4.257–4.392 | 5,716 |
| wasm-tokens-unroll | 4.263 | 4.235–4.263 | 5,132 |

The final Wasm candidates are the best scalar/hybrid finalists from a 21-variant search: UTF-8 staging, UTF-16 staging with three copy loops, translated tokens, scalar/high queues, fixed-phase unrolling, branch-free stores and ASCII blocks. Staging, memory growth when required, decoding and exact output copying are included. The previous delivered module is frozen byte-for-byte as utf8-previous. The selected sign-sentinel lookup removes a mask per symbol and shrinks the module from 2,342 to 2,319 bytes without changing API, packet format, validation or errors. A 128 KiB table did not justify its memory against the 4 KiB table.

An additional SIMD prototype passed native Node vectors and a 1 MiB output hash but crashed this Chromium renderer. It has no accepted browser timing and is excluded. Its cause is unresolved; this does not establish that SIMD is unsupported. Experimental kernels never enter the distribution. See [the backend study](../../../docs/utf8-backends.md) for reproduction and rejected candidates.

## Correctness and limits

Both Chrome versions pass 1,600 valid native vectors (including all 256 masks), 2,529 rejection cases and 2,748,964 ordered NFC alphabet pairs. 9 offline file pages include hostile script sequences and 10 MiB native HTML; Wasm, decompression streams and fetch are disabled. A UTF-8 BOM also survives deliberately incorrect HTTP charset metadata. This is structural validation, not data integrity or authentication.

Both browsers additionally pass 131,072 exhaustive UTF-16-unit output/error comparisons and 10,000 bounded random-mutation comparisons with the independent decoder.

This is one unpinned Linux aarch64 host, not a cross-device guarantee. Raw samples, process ranges, versions, module hashes, input hashes and timing policy are preserved. Malformed inputs run in separate processes from timing.

- [Compact summary CSV](summary.csv): random 1 MiB, selected decoder and two Base122 baselines.
- [All aggregated decode comparisons](decode.csv): every selected candidate, dataset and browser, with process ranges.
- [Every measured batch](final.json).
- [Offline compatibility and exact file sizes](compatibility.json).
- [Protocol, limitations and reproduction](../../../docs/utf8-raw.md).

Earlier screen/groups/stores/split/bounded JSON files preserve the candidate search; they are separate campaigns and must not be pooled with the final timing.
