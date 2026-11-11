# Charset and packing migration decision

All HTML uses the same inert raw-script container. The pair and UTF-16 ANS candidates share the 63,385-symbol production alphabet. Windows candidates use 254 or 253 single-byte source symbols. All use the production allocator, selected XOR mask, BLAKE3, output ownership and JS/Wasm adapter. These experiments do not change production defaults.

[Four-row summary CSV](compact.csv) · [All decode timings](timings.csv) · [Migration policy sizes](migration-sizes.csv)

## 10 MiB random input, BLAKE3

Source includes headers and trailers. Complete HTML includes the real decoder, loader, framing and BOM where applicable. Retained Wasm memory is capacity after a call, not peak application memory. Values are medians of three independent processes.

| Mode | Source overhead | HTML bytes | Decode 156 | Decode 109 | Ready 156 | Ready 109 | Wasm MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pair-control | 0.4035% | 10547534 | 39.7 ms | 35.0 ms | 228.9 ms | 280.5 ms | 32.25 |
| ans4 | 0.3024% | 10536490 | 33.8 ms | 32.4 ms | 245.7 ms | 262.9 ms | 32.25 |
| windows254 | 0.1422% | 10511131 | 53.0 ms | 49.1 ms | 473.7 ms | 408.1 ms | 48.25 |
| windows253 | 0.2135% | 10518607 | 53.0 ms | 49.0 ms | 443.7 ms | 393.8 ms | 48.25 |

## Small-file costs

Actual complete HTML byte counts. The decoder's source encoding matters most at small payload sizes.

| Input | UTF-16 pair | UTF-16 ANS4 | Windows 254 | Windows 253 |
| --- | ---: | ---: | ---: | ---: |
| empty | 19504 | 19082 | 10519 | 10511 |
| random-1KiB | 20532 | 20106 | 11543 | 11535 |
| random-1MiB | 1072272 | 1070818 | 1060579 | 1061319 |
| random-10MiB | 10547534 | 10536490 | 10511131 | 10518607 |

## Would ANS always make the UTF-16 file smaller?

No. Exact source+module budgets below count the actual payload plus twice the ESM bytes, excluding HTML glue. Positive deltas mean ANS is larger. Core is unchecked/no hash; full contains all 12 runtime choices and is evaluated with secure payloads.

| Input | Secure specialization delta | Full-policy module delta | Core/no-hash delta |
| --- | ---: | ---: | ---: |
| random-1KiB | -426 B | -3194 B | -50 B |
| random-1MiB | -1454 B | -4222 B | -1078 B |
| random-10MiB | -11044 B | -13812 B | -10668 B |
| json-logs | 2734 B | -34 B | 3114 B |
| zeros-1MiB | 2738 B | -30 B | 3114 B |
| utf8-text | 2762 B | -6 B | 3138 B |
| gzip-logs | -496 B | -3264 B | -120 B |
| decoder-wasm | -360 B | -3128 B | 16 B |

## Compatibility observations

Both browsers passed correct and absent HTTP charsets. With a deliberate UTF-8 HTTP header, both Windows files failed, while every UTF-16 file with its BOM succeeded. Escaped Unicode page titles and JS strings worked in both charsets. Literal Chinese/emoji source cannot be represented directly in Windows-1252; HTML entities and JS Unicode escapes preserve full displayed Unicode. These are source/transport constraints, not an inability to display Unicode.

The same Windows-alphabet codec also works after correct UTF-8 transcoding, but the physical size advantage vanishes:

| File | Windows source bytes | UTF-8 transcode bytes |
| --- | ---: | ---: |
| windows254 | 10511131 | 16505490 |
| windows253 | 10518607 | 16542562 |

## Alphabet bounds

For uniformly random long inputs, before framing and finite-state overhead:

| Alphabet / storage | Information bound on expansion |
| --- | ---: |
| 63385 symbols / 16-bit source | 0.301822% |
| 254 symbols / 8-bit source | 0.141642% |
| 253 symbols / 8-bit source | 0.213033% |

This is an asymptotic uniform-input alphabet bound, not a bound on every input's entropy. The present uniform ANS model closely approaches it. The pair codec can have lower expansion on nonuniform inputs through data-dependent 31/32-bit choices and XOR selection. Neither codec changes UTF-16LE's browser capabilities.

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
