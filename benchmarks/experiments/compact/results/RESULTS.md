# Matched UTF-16 packing and optional-builder experiment

All packings use the **same 63,385-symbol production alphabet, same selected XOR mask, same message/trailer, same production allocator, same hash sources and same JS/Wasm adapter**. Only the transport changes. Pair control is compiled from unmodified production kernel sources. Production artifacts remain unchanged.

[Small decision CSV](decision.csv) · [All decode timings](timings.csv) · [Complete-file sizes](standalone-sizes.csv) · [Raw cold samples](cold.csv)

## Secure 10 MiB random input

Complete raw-script HTML includes the actual decoder, gzip/base64 loader and UTF-16LE BOM. Warm measurements include fresh returned buffers and BLAKE3. Cold ready includes actual offline file parsing, module initialization and the first verified decode. Values are milliseconds.

| Profile | HTML bytes | Saved vs pair | Warm 156 | Warm 109 | Raw ready 156 | Raw ready 109 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pair-control | 10547528 | 0 B | 37.10 | 34.90 | 269.9 | 264.7 |
| ans1 | 10535530 | 11998 B | 43.10 | 39.30 | 272.5 | 278.7 |
| ans4 | 10536484 | 11044 B | 35.30 | 32.50 | 260.2 | 265.7 |
| ans8 | 10537476 | 10052 B | 36.90 | 32.20 | 274.8 | 249.8 |
| both-pair | 10549336 | -1808 B | 37.50 | 34.40 | 253.8 | 250.2 |
| both-ans4 | 10538740 | 8788 B | 35.50 | 34.00 | 269.3 | 266.8 |

## Hold the HTML container constant

Three fresh browsers/profiles per point. Brackets show the observed range, not confidence intervals.

| Profile | Container | 156 ready median [min,max] | 109 ready median [min,max] |
| --- | --- | ---: | ---: |
| pair-control | raw | 269.9 [264.2, 283.2] | 264.7 [256.1, 293.5] |
| pair-control | template | 347.9 [342.4, 366.2] | 410.5 [361.2, 420.6] |
| ans1 | raw | 272.5 [248.4, 287.2] | 278.7 [262.0, 289.9] |
| ans1 | template | 349.1 [345.7, 397.4] | 403.9 [390.4, 418.2] |
| ans4 | raw | 260.2 [256.2, 292.5] | 265.7 [243.2, 296.9] |
| ans4 | template | 361.7 [341.0, 394.6] | 402.8 [352.7, 441.2] |
| ans8 | raw | 274.8 [246.9, 284.7] | 249.8 [244.5, 253.4] |
| ans8 | template | 361.1 [332.7, 399.9] | 376.4 [339.1, 395.1] |
| both-pair | raw | 253.8 [244.1, 287.5] | 250.2 [239.0, 259.9] |
| both-pair | template | 370.8 [330.4, 373.8] | 374.2 [372.5, 391.2] |
| both-ans4 | raw | 269.3 [255.5, 272.4] | 266.8 [265.9, 268.2] |
| both-ans4 | template | 388.1 [351.1, 398.4] | 388.3 [368.0, 398.0] |

## Payload-specific size tradeoff

Actual secure raw-script file bytes saved against the dedicated production pair decoder; negative values mean a larger file. `both-auto` is a size simulation choosing the smaller available body for the combined decoder, not an exported automatic encoder policy.

| Dataset | ANS smallest (1 state) | ANS balanced (4 states) | Combined, choose smaller body |
| --- | ---: | ---: | ---: |
| random-1KiB | 1378 B | 426 B | -1808 B |
| random-64KiB | 1432 B | 482 B | -1774 B |
| random-1MiB | 2404 B | 1454 B | -802 B |
| random-2097152B | 3446 B | 2492 B | 236 B |
| random-4194304B | 5584 B | 4632 B | 2376 B |
| random-10MiB | 11998 B | 11044 B | 8788 B |
| json-logs | -1784 B | -2734 B | -1808 B |
| gzip-logs | 1446 B | 496 B | -1760 B |
| zeros-1MiB | -1788 B | -2738 B | -1808 B |
| utf8-text | -1810 B | -2762 B | -1808 B |
| decoder-wasm | 1314 B | 360 B | -1808 B |

## Decoder cost

Actual independent ESM bytes; the Wasm column includes no loader. Public adapters are assembled with the real builder. Secure, full and unchecked/core policies are separate specializations.

| Build | ESM bytes | Wasm bytes | Gzip Wasm bytes |
| --- | ---: | ---: | ---: |
| pair-control | 9225 | 15861 | 5854 |
| pair-control-full | 12143 | 21297 | 7703 |
| pair-control-core | 2988 | 2547 | 1311 |
| pair | 9213 | 15843 | 5846 |
| ans4 | 9001 | 16111 | 5688 |
| ans1 | 8533 | 14630 | 5337 |
| ans2 | 8841 | 15102 | 5568 |
| ans8 | 9485 | 17188 | 6049 |
| ans-low | 9045 | 16067 | 5721 |
| both | 10129 | 18230 | 6534 |
| pair-full | 12143 | 21337 | 7703 |
| ans4-full | 10535 | 18773 | 6496 |
| both-full | 13607 | 25761 | 8802 |
| pair-core | 3076 | 2639 | 1375 |
| ans4-core | 2952 | 2783 | 1282 |
| both-core | 3952 | 4684 | 2034 |

## All 12 runtime policies on Chromium 156

Matched full kernels, random 1 MiB, milliseconds. Heavy-table allocation is warmed and excluded from these repeated calls. It applies to pair packing; ANS does not need that table. Chrome 109 and other inputs are in the timing CSV.

| Verification | Format | Heavy | Pair | ANS4 | Combined/pair | Combined/ANS4 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| none | false | false | 2.700 | 2.400 | 2.900 | 3.000 |
| none | false | true | 2.800 | 2.300 | 2.900 | 2.300 |
| none | true | false | 2.500 | 2.400 | 2.600 | 3.100 |
| none | true | true | 3.000 | 2.300 | 2.600 | 2.500 |
| fast | false | false | 2.700 | 2.600 | 3.400 | 2.500 |
| fast | false | true | 2.800 | 2.600 | 3.000 | 2.500 |
| fast | true | false | 2.800 | 2.600 | 3.500 | 2.600 |
| fast | true | true | 2.800 | 2.600 | 2.900 | 2.600 |
| secure | false | false | 4.200 | 3.400 | 3.600 | 4.100 |
| secure | false | true | 4.400 | 3.400 | 3.700 | 4.100 |
| secure | true | false | 4.300 | 4.100 | 4.300 | 4.200 |
| secure | true | true | 3.600 | 4.100 | 3.600 | 4.200 |

## Recommendation

An optional compact packing is useful for users embedding already compressed or
otherwise high-entropy assets. Keep the current pair format as the default:
structured text and repetitive data can already achieve almost zero body
overhead with its existing XOR selection. Forcing ANS on those inputs can make
the whole file larger.

The four-state precise ANS profile is the balanced choice. At 10 MiB random
input, its secure standalone is 11,044 bytes smaller than the matched pair
control. Warm verified decoding measured 35.3 vs 37.1 ms on 156 and 32.5 vs
34.9 ms on 109. Process ranges overlap, so the evidence supports comparable
performance rather than a guaranteed speedup. Its raw-script cold startup is
260 vs 270 ms on 156 and 266 vs 265 ms on 109, also overlapping. The much larger
startup penalty in the earlier experiment came mainly from changing containers;
these matched tests do not reproduce an inherent ANS startup penalty.
The full-policy matrix also shows that enabling the pair decoder's heavier
lookup-table optimization can make it faster than ANS. ANS therefore does not
dominate every selected runtime policy, even on the same random input.

The one-state profile minimizes complete size: it saves another 954 bytes at
10 MiB, but takes 43.1/39.3 ms to decode. That is a reasonable separate
`ans-small` choice for callers prioritizing bytes. Eight states did not give a
consistent advantage over four across the two browsers, and its larger decoder
loses some compactness. The genuinely 32-bit low-precision candidate increases
payload size and showed no compelling screening speed benefit.

A combined pair+ANS4 decoder adds 904 ASCII ESM bytes versus the matched secure
pair control, or 1,808 bytes once embedded in this UTF-16 HTML. It pays for itself
around 2 MiB of random input in the measured size sweep: 1 MiB is still 802 bytes
larger, 2 MiB saves 236 bytes, and 10 MiB saves 8,788 bytes. The full-policy
combined ESM adds 1,464 bytes versus its pair counterpart, so its break-even is
later. Several payloads may amortize one decoder, but their aggregate savings
must exceed that decoder cost. Exact break-even depends on the data and build
policy; 2 MiB is a sampled result, not a universal cutoff.

The prototype builder demonstrates `pair`, `ans`, `ans-small` and comma-separated
combinations. Only selected unpackers are compiled; a combined build dispatches
using the packet header. A future automatic encoder should compare the actual
escaped payload and selected decoder size, not assume ANS always wins. The
`both-auto` row models the simpler case of choosing the smaller body after
committing to a combined decoder. Production flags and wire format are untouched.

## Method and limits

The final warm matrices contain 1,422 checked process/case rows and 12,798
measured batch samples. There are 288 actual offline HTML loads. The correctness
suite passed 96,354 successful decodes and 4,442 rejection controls across both
browsers, including 68,688 successful full-policy cases. Separate CLI checks
validate the actual custom modules emitted for balanced, smallest and combined
builds. Raw samples, rejection counts and artifact hashes accompany the CSVs.

This is a local prototype of a builder packing axis, not a production format
migration. `pair` is the current 31/32-bit codec. Experimental ANS headers occupy
reserved format-3 header bands and identify the state layout. A combined kernel
dispatches once per packet; the caller supplies no new decoding option. Missing
profiles are rejected, except that the unmodified unchecked pair/core decoder
retains its historical acceptance of noncanonical representations.

The precise ANS candidates use 47-bit states and 16-bit symbols. One state
minimizes decoder code and framing; four expose independent calculation chains;
eight were also measured. The low-precision four-state candidate really uses
32-bit arithmetic, but loses density. All variants preserve the existing Unicode
exclusions, XOR mask, endian order, integrity algorithms and fresh-buffer result.
The wire representation of an ANS packet is intentionally new.

All candidates receive the exact same production-selected XOR mask, including
the digest in selection. The experiment optimizes no ANS-specific mask search.
Native encoding, masks, hash preparation, setup transport and independent
SHA-256 checks are excluded from decoder timing. The main matrix uses dedicated
secure profiles. The policy matrix measures all 12 format/data/memory settings
through full kernels. Core-only builds provide a separate no-hash comparison.
Heavy lookup tables apply only to pair decoding; compact decoding does not
allocate an unused high-digit table when that runtime option is enabled.

Every campaign uses three independent browser processes, three warm-up batches
and nine measured batches. Reported central values are medians of process
medians. Module hashes tie the checked binary to every timed variant. Browser
versions are Chromium 156.0.8078.79 and Chrome 109.0.5414.119 on ARM64. CPU clocks,
scheduling and GC are unpinned. Short-call timings have broad run ranges; small
differences are not universal performance guarantees.

The cold suite opens actual self-contained UTF-16LE files with `file://` and
network disabled, in a fresh process/profile for every file. It checks document
charset, trailing marker, zero network requests and exact SHA-256 outside timing.
Browser launch is excluded, but file reads, parsing, native gzip inflation,
Wasm initialization and first verified decoding are included. OS file caching
may be warm. Raw-script and cooked-template comparisons use identical alphabets
and matching algorithms; the earlier container confound is removed.

Standalone file sizes are exact: framing bytes are obtained from generated
files, checked invariant across sizes, then added to each corpus's measured raw
or escaped source. The combined `both-auto` size row chooses the shorter pair or
ANS4 body; it describes a possible native encoder policy. Actual generated
combined files and measured decoder calls explicitly select one stored body.
Decoder gzip/base64 loading uses native `DecompressionStream`; payload data is
not additionally compressed by the uniform ANS model. The gzipped-log corpus is
already compressed input.

Default verification remains BLAKE3 plus format checking. BLAKE3 is an unkeyed
integrity digest rather than authentication against an attacker able to replace
both message and digest. Checked and unchecked paths retain independent length,
allocation and trailer bounds. ANS additionally requires valid initial/terminal
states, full body consumption and zero odd-word padding. Canonical stale digest
vectors test checksum verification independently of those structural checks.
