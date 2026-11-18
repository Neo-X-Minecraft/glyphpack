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
