# Packing choices and local evidence

Use `pair` for small payloads, `ans` for larger UTF-16 payloads, and `windows`
when source size matters enough to accept a single-byte document and slower
decoding. These are recommendations, not automatic size cutoffs. The UTF-8 alternatives are `utf8` for speed and
`utf8-compact` for smaller UTF-8 files. [Current five-codec integration](integration.md).
All five are uniform binary transports; compress suitable input first.

```sh
glyphpack encode input.bin --packing ans -o payload.utf16
glyphpack build --packing pair ans -o decoder.mjs
glyphpack build --full -o full.mjs
```

`--packing` accepts any nonempty subset, separated by spaces or commas. Fixed
codec builds omit the other kernels. Full builds include all five codecs,
none/XXH32/BLAKE3, both format policies and both memory policies. No runtime
packing option is needed: the leading payload code unit selects the codec.
An unsupported codec throws `Unsupported payload codec` before the JS input
copy; direct Wasm callers get status 9. This guard survives unchecked builds.
See [the wire specification](format.md).

## Earlier three-codec production measurements

These measurements use the full distribution from commit `eef9cab`, before the
explicit warm-up API, on Linux aarch64, Node
24.21.0, Chromium **156.0.8078.79** and Chrome **109.0.5414.119**. Every input is
the same deterministic pseudorandom prefix (LCG seed 815), with sampled automatic
mask selection. All 12 integrity/format/memory settings were timed for every
codec at 1 KiB, 64 KiB, 1 MiB and 10 MiB: **288 browser/profile records**.

The table below selects secure/default verification, format on, memory-heavy
off. Times are medians of five warm batch measurements. They include string
copy into Wasm, decoding, BLAKE3 and copying owned bytes back to JS. Imports,
HTML parsing and fixture construction are excluded. Timings are from one
unpinned host, not guaranteed rankings or individual-call tail latency.

| 10 MiB input | Payload source bytes | Overhead | Chromium 156 | Chrome 109 |
| ------------ | -------------------: | -------: | -----------: | ---------: |
| Pair         |           10,528,192 |   0.405% |      35.7 ms |    34.1 ms |
| UTF-16 ANS   |           10,517,472 |   0.302% |      34.2 ms |    32.1 ms |
| Windows-1252 |           10,500,667 |   0.142% |      51.0 ms |    48.6 ms |

Source bytes include the codec field, header, ANS states and digest, but not a
decoder or HTML shell. At 1 KiB the corresponding sizes were 1,066 / 1,086 /
1,079 bytes; pair's smaller framing wins there. At 64 KiB they were 65,826 /
65,790 / 65,683 bytes. Input structure and masking can change these comparisons.

In that campaign the secure single-codec ESMs were roughly 9.2–9.4 KB each as
ASCII files; the full module was 15,570 bytes. Consult `dist/profiles.json` for current module,
Wasm and gzip sizes. UTF-16 HTML doubles ASCII shell/code bytes relative to a
single-byte shell; calculate complete-file cost for your own template.

Windows-1252 works across operating systems and requires no additional browser
API. Its restrictions are about the container: use the correct meta/HTTP charset,
escape shell characters outside its repertoire, preserve controls and read inert
script data verbatim. UTF-8 reserialization loses its compactness advantage.
Wasm still receives UTF-16 code units, so Windows packing has a larger input copy
and arena requirement than the similarly sized UTF-16 pair/ANS source files.
One HTML document has one charset; a mixed decoder does not change that rule.

## Making pair smaller

The separate source-size study checks **102 packets** against an independent
reference packer, including short lengths, zero/FF patterns, pseudorandom data,
all three integrity modes and lengths through 10 MiB. Each candidate keeps the
same selected mask. It does not include a candidate decoder's added code size.

| Candidate                                                 | Observed opportunity                                                      | Decision                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Omit a final zero high digit                              | Two source bytes on eligible tails                                        | Keep for a later wire-format revision; small gain, new tail rules         |
| A one-unit tiny header                                    | Two bytes when stored length is below 40; with BLAKE3, data below 8 bytes | Keep as a proposal; benefits only very short packets                      |
| Widen the raw-script alphabet from 63,385 to 63,485 units | 1,944 bytes saved on the tested 10 MiB pseudorandom secure packet         | Keep current alphabet; ANS already saved 10,720 bytes without changing it |
| Compress the input first                                  | Potentially much larger savings on compressible data                      | Recommended when appropriate; measure full decode/decompress cost         |

The implemented pair header/body stays byte-for-byte compatible with format 3;
new encoding adds only its two-byte UTF-16 indicator. Modern pair-capable builds
still accept unmarked format-3 packets. The proposed tail/header/alphabet changes
are experiments, not accepted alternate encodings.

## Reproduce and inspect

```sh
cargo run --release --locked -- build --all
cargo run --release --locked -- test-codecs
cargo run --release --locked --example codec_bench
node benchmarks/codecs.cjs
cargo run --release --locked --example pair_compactness
```

`CHROMIUM_BIN` and `CHROMIUM109_BIN` select installed browsers. Encoding and
correctness work happens outside timing. The benchmark warms every case, rotates
execution order, consumes results, and records all five samples plus min/max.
It uses one fresh browser process per version; repeat across processes/hosts
before choosing a performance cutoff.

[All timing rows](../benchmarks/results/packing/decode.csv),
[environment and raw batches](../benchmarks/results/packing/environment.json),
[pair candidates](../benchmarks/results/packing/pair-candidates.csv), and
[browser compatibility evidence](../benchmarks/results/packing/compatibility.json).
Both browsers passed 80,136 positive cases, 108 unsupported-codec rejections,
1,500 malformed/stale-digest rejections, 36 large cases and six offline decodes.
The offline checks use actual CLI injection for each charset, and a UTF-16LE
document mixing all three packet types. Direct ABI checks also cover omitted
codecs and input/output arena separation.
