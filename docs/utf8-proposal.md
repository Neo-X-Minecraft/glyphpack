# Assessment of UTF-8 arithmetic packing

The supplied document's arithmetic codec is a useful candidate for an optional
UTF-8 HTML mode. It fills a different container requirement from the current
UTF-16 pair/ANS and Windows-1252 modes. This experiment does not change the
production format, builder, defaults or generated distributions.

## Measured size and speed

The same deterministic 1 MiB input, without integrity verification:

| Transport | Payload source bytes | Overhead | Chromium 156 decode | Chrome 109 decode |
| --- | ---: | ---: | ---: | ---: |
| Base64 | 1,398,104 | 33.33% | 1.02 ms | 15.78 ms |
| Base122 | 1,198,373 | 14.29% | 4.68 ms | 5.46 ms |
| UTF-8 arithmetic, reference | 1,170,479 | 11.63% | 186.65 ms | 185.25 ms |
| UTF-8 arithmetic, independent fast candidate | 1,170,479 | 11.63% | 138.66 ms | 140.89 ms |
| UTF-8 arithmetic, NUL-free reference | 1,171,920 | 11.76% | 186.70 ms | 185.02 ms |

Times are medians of three process medians. Chromium 156 is 156.0.8078.79;
Chrome 109 is 109.0.5414.119. The unpinned host is Linux aarch64. The Base64 row
uses native `Uint8Array.fromBase64` where present, and `atob` plus a byte-copy
loop otherwise. Base122 selects the fastest measured candidate among the local
inline/block/counted, upstream reference and fork implementations. It does not
claim a globally fastest implementation. All tested implementations recovered
the same bytes; their structural-validation policies differ.

The dense UTF-8 payload saves **27,894 bytes, or 2.33%**, over Base122 in this
case. Its reconstructed fast decoder takes about **30× as long** in Chromium
156. Current Pair decoding without verification takes 2.36 ms / 2.68 ms in
these same two browsers, but uses a different document encoding.

The minified standalone reference arithmetic assignment occupies 1,047 UTF-8
bytes; the independent browser-fast assignment is 1,435 bytes. These include
the complete decoder function but exclude metadata and HTML framing. For 1 MiB,
the complete dense HTML occupies **1,171,736 bytes** with the reference decoder,
or **1,172,058 bytes** with the fast candidate. Profile metadata accounts for
part of the framing difference. Neither contains Wasm or a decompression loader.

## What the document's ending establishes

The final section proposes three implementations: a grouped-prefix Node decoder,
a browser-fast decoder, and a compact decoder. It reports a 3.92× Node gain and
a 1.33× browser gain. Its named optimized source files, including `dense.mjs`
and `dense-small.mjs`, are absent from the supplied document and the workspace.
Those exact implementations and measurements cannot be independently reproduced
from the included source.

The independent browser candidate here follows the described fixed CDF, direct
Unicode traversal, ASCII specialization, inline HTML recovery and output-bit
writes. It yields a **1.35× / 1.31×** speedup over the included reference on our
two tested browsers, preserving the original payload. This supports the
browser strategy without claiming to have tested the missing implementation.
The reported Node-versus-browser strategy split remains a hypothesis to retest
with its actual source and current engines.

The enumerative codec remains useful as a mathematical reference and passes the
browser tests. Its large BigInt tables and arithmetic make it a poor default
for speed-sensitive decoding. No new enumerative performance claim is made.

## Compatibility is a property of the channel

UTF-8 removes the document-charset requirement of our other dense modes. The
standalone decoder also needs no Wasm, `DecompressionStream`, module loader or
runtime network access. Both browser versions passed actual byte-file navigation
and HTTP serving, with those APIs disabled. This is useful evidence for Chrome
109+, rather than a test of every browser or text-processing pipeline.

The densest alphabet contains raw NUL, other control characters, noncharacters
and supplementary scalars. HTML script tokenization replaces NUL with U+FFFD;
the codec reserves that scalar and restores the original symbol. CR is excluded
because HTML normalizes line endings. Reversible guards prevent premature
script closure and entry into the legacy comment states.
See the [HTML tokenizer](https://html.spec.whatwg.org/multipage/parsing.html#script-data-state)
and [script contents rules](https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements).
Some permitted source characters cause specified HTML parse errors; the tests
exercise the resulting tokenization rather than claiming validator-clean HTML.

NUL-free is a reasonable practical profile: it costs only **1,441 extra bytes**
in the tested 1 MiB payload. It still permits the other control characters; it
does not promise survival through trimming, Unicode normalization, sanitizers,
attributes, URLs or arbitrary copy/paste tools.

For example, `JSON.stringify` makes the dense UTF-8 string **2,176,095 bytes**,
versus **1,398,106** for Base64, because controls need escaping. Base122 also
grows here, to 2,387,264 bytes. The UTF-8 density result applies to the intended
HTML script-text channel, not every textual container.

The control characters supply real density. Even retaining all non-ASCII scalars,
excluding C0 controls except TAB/LF and excluding DEL lowers the ideal capacity
to about **16.18% overhead** before framing. This is a counting-model estimate,
not a measured codec. It already exceeds Base122's usual raw payload overhead.
The dense mode cannot promise every conventional text-safety property at 11.63%.

## Integration recommendation

Add this as an explicitly selected `utf8` packing option if UTF-8 source files
are a priority. A fixed-profile, plain JavaScript decoder can preserve its small
standalone footprint. Benchmark a Rust/Wasm arithmetic backend before choosing
one; the numerical loop may improve, but copies and initialization also count.

Retain Pair/ANS/Windows for their density and speed tradeoffs. Retain Base64
when broad ASCII interoperability or native decode speed is the requirement.
Choose the dense versus NUL-free profile explicitly; do not label either one
universally text-safe.

Production integration still needs an embedded version/length indicator,
compiled-codec rejection, existing verification policies, mandatory allocation
bounds and the builder's specialization. The prototype's external length/CDF
metadata and lack of integrity verification are not the current `binary()`
contract. A secure digest and framing add measurable bytes. The experimental
decoder has a proportional allocation bound, but is not a hardened production
replacement for the existing decoder.

## Checks and reproduction

- The supplied reference suite passes 2,528 byte round trips and 3,336,311 scalar
  mapping checks, plus eleven actual `file://` HTML pages in each browser. The
  pages include every permitted Unicode scalar and hostile script prefixes.
- The independent fast candidate passes 2,590 differential cases, including
  parser-style NUL replacement and eight deliberately constructed leading
  hazards, plus nine malformed-input checks.
- The matched comparison navigates twelve standalone files per browser over
  `file://` and HTTP, with Wasm, decompression streams and runtime fetch disabled:
  48 additional browser page checks. All decoded outputs match SHA-256 and length.
- Timings cover resident string to fresh output bytes at 1 KiB, 64 KiB and 1 MiB.
  Three fresh processes per browser, five rotated measured batches. Encoding,
  import, file parsing and correctness checks are outside the timer. There is no
  data-integrity verification in any timed variant.

The [research directory](../benchmarks/experiments/utf8/README.md) contains the
reference sources, independent candidate and reproduction commands.
[Small shareable summary](../benchmarks/results/utf8-proposal/summary.csv),
[Payload and HTML sizes](../benchmarks/results/utf8-proposal/sizes.csv),
[all decoder samples](../benchmarks/results/utf8-proposal/decode.csv),
[environment and complete results](../benchmarks/results/utf8-proposal/results.json), and
[verification record](../benchmarks/results/utf8-proposal/verification.json)
are retained separately. Firefox and WebKit were unavailable and were not tested.
