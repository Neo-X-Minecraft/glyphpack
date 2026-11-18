## Decision

There is no browser-compatibility reason to avoid UTF-16 ANS. Both UTF-16 codecs
store the same Unicode alphabet in UTF-16LE and use the same Wasm baseline. ANS
does not require JavaScript BigInt or a newer browser feature: its wider state
stays inside Wasm. It changes the packet format, so existing payloads need their
matching old decoder or re-encoding; existing self-contained files keep working.

A complete deletion of pair packing is not a universal size optimization. Its
near-zero body expansion on structured data beats the uniform ANS model's
roughly 0.302% expansion. The measured secure specialization loses about 2.7 KB
on a 1 MiB structured/text example by forcing ANS; the full-policy decoder's
larger code saving can offset that at small sizes, but the body penalty grows
with input length. None of these is a fundamental restriction of ANS as an
algorithm family: this is our uniform-model implementation and selected build
policy. A frequency-adaptive compressor would be a separate design to benchmark.

Windows-1252 has a substantial speed, input-buffer and hosting tradeoff for a
small additional size gain. In this matched raw-script run its 254-symbol file
saves 25,359 bytes versus UTF-16 ANS at 10 MiB, while decoding about 1.57x slower
on Chromium 156 and retaining 16 MiB more Wasm memory. Its header requirements
are a real source-transport compatibility restriction. It is not a Windows-OS
dependency: both tested browser versions support it on this Linux/ARM64 host.

The 253-symbol Windows variant excludes source NUL. The 254-symbol variant
intentionally uses HTML's NUL-to-U+FFFD mapping as one transport digit; both
decode correctly in the tested browsers. Removing NUL costs 7,484 source bytes
at 10 MiB and does not fix conflicting HTTP charsets or literal Unicode source
restrictions. These are variants of one compact transport, not a need for a
fourth main builder mode.

Suggested builder design: two main packaging presets, with the three codecs
still independently selectable for reusable decoder builds.

- **UTF-16 packaging:** when inputs are known, compare complete pair-only,
  ANS-only and combined-codec costs, then compile only the selected unpackers.
  ANS4 is a good balanced choice for already compressed/high-entropy assets;
  pair remains useful for structured data and some memory-heavy speed profiles.
- **Windows-1252 compact packaging:** explicit opt-in for callers controlling
  the document charset and accepting the measured decode/memory penalty.

For a generic decoder builder with no input files, retain explicit `pair`,
`ans` and `windows1252` choices instead of promising an automatic size winner.
Simply defaulting every payload to ANS is a coherent simplification if the
~0.3% structured-data tradeoff is acceptable, but it is not an across-the-board
improvement. Windows should not be the universal default. No production migration
or default change is performed by this comparison.

## Measurement scope

Both warm runs use three browser processes, three warmups and nine measured
batches per process. Fresh output copies, format checks, default BLAKE3 and
JS/Wasm bridges are timed. Native encoding, mask selection, transfer setup and
independent SHA-256 comparisons are outside timers. The memory hook captures
the actual exported Wasm memory only during module import and is restored
before timing; capacities are retained linear memory, not peak total memory.

There are 216 warm process/case rows, 1,944 measured batch samples, 120 fresh
offline file loads, 30 HTTP-charset cases and 14 Unicode/transcoding probes.
Each browser also passed 20 reference cases and 120 truncation rejections for
these exact modules. These supplement the prior compact codec's much larger
validation and 12-policy matrix. Kernels use the same compiler/optimizer path,
production allocator, verifier and adapter. Raw results include module hashes.
The machine is ARM64; CPU clocks, scheduling and GC are not pinned. Cold OS
caches may be warm. Ranges overlap for small performance differences; these
are local measurements, not guarantees for every device.

References: [HTML charset detection](https://html.spec.whatwg.org/multipage/parsing.html#determining-the-character-encoding),
[script data parsing](https://html.spec.whatwg.org/multipage/parsing.html#script-data-state),
[WebAssembly number types](https://webassembly.github.io/spec/core/syntax/types.html#number-types),
[ANS paper](https://arxiv.org/abs/1311.2540).
