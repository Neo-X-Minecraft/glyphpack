# UTF-8 versus Base122

Recorded 2026-11-13T16:37:01.206Z; arm64, unknown.

The selected UTF-8 decoder is **2,342 bytes**, with a 4 KiB lazy table. It returns validated, owned, exactly sized output. The Base122 competitors keep their unchecked/view-returning policies. Neither side computes a digest.

## Complete standalone file size

Identical 1 MiB synthetic random bytes; actual UTF-8 files with BOM, metadata, decoder, container escaping and payload:

| Implementation | Complete HTML bytes |
| --- | ---: |
| native-zero | 1,193,226 |
| base122-reference | 1,198,781 |
| base122-groupUnroll | 1,199,801 |

Payload alone: 1,190,768 bytes for UTF-8 raw and 1,198,373 for Base122. Expected asymptotic uniform-random overhead is 13.5593% versus 14.2857%. These are measured file sizes, not compressed download sizes or string code units. Small payloads may favor Base122 because its smallest decoder is smaller.

## Complete warm decode

Milliseconds per full call: allocation, header, body, XOR and mandatory structural checks are included. Import/HTML parse/encoding/output verification are outside the timer. Each entry is the median of 3 independent process medians, each based on 9 rotated batches. The table selects the fastest tested Base122 candidate separately per input/browser; this favors the competitor and is not one adaptive Base122 implementation. Positive difference means UTF-8 raw took longer.

| Chrome | Input | UTF-8 raw ms | Fastest Base122 ms | Base122 loop | Time difference |
| --- | --- | ---: | ---: | --- | ---: |
| 156 | bootstrap | 0.045 | 0.043 | groupUnroll | 4.0% |
| 156 | random-1KiB | 0.004 | 0.004 | groupUnroll | -8.3% |
| 156 | random-64KiB | 0.194 | 0.196 | groupUnroll | -1.4% |
| 156 | random-1MiB | 3.603 | 3.457 | groupUnroll | 4.2% |
| 156 | zeros-1MiB | 1.733 | 2.910 | groupUnroll | -40.5% |
| 156 | sequential-1MiB | 3.067 | 2.860 | groupUnroll | 7.3% |
| 109 | bootstrap | 0.052 | 0.057 | groupUnroll | -8.3% |
| 109 | random-1KiB | 0.004 | 0.005 | blockStores | -17.3% |
| 109 | random-64KiB | 0.274 | 0.240 | groupUnroll | 14.4% |
| 109 | random-1MiB | 4.185 | 4.050 | groupUnroll | 3.3% |
| 109 | zeros-1MiB | 2.157 | 3.465 | groupUnroll | -37.7% |
| 109 | sequential-1MiB | 3.580 | 3.565 | groupUnroll | 0.4% |

The group-unrolled Base122 candidate applies this format's main constant-shift insight to Base122 too. Comparing only with the slower historical baseline would overstate the gain. The result is a size advantage at competitive decode speed, not a universal speed record. Zero/sequential/ASCII fixtures can favor different loops; the same UTF-8 implementation is used throughout.

## Correctness and limits

Both Chrome versions pass 1,600 valid native vectors (including all 256 masks), 2,529 rejection cases and 2,748,964 ordered NFC alphabet pairs. 9 offline file pages include hostile script sequences and 10 MiB native HTML; Wasm, decompression streams and fetch are disabled. A UTF-8 BOM also survives deliberately incorrect HTTP charset metadata. This is structural validation, not data integrity or authentication.

This is one unpinned Linux aarch64 host, not a cross-device guarantee. Raw samples, process ranges, versions, module hashes, input hashes and timing policy are preserved. Malformed inputs run in separate processes from timing.

- [Six-row summary CSV](summary.csv): random 1 MiB, selected decoder and two Base122 baselines.
- [All aggregated decode comparisons](decode.csv): every selected candidate, dataset and browser, with process ranges.
- [Every measured batch](final.json).
- [Offline compatibility and exact file sizes](compatibility.json).
- [Protocol, limitations and reproduction](../../../docs/utf8-raw.md).

Earlier screen/groups/stores/split/bounded JSON files preserve the candidate search; they are separate campaigns and must not be pooled with the final timing.
