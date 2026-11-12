# Fast UTF-8 transport

This working experiment replaces the arithmetic loop with a small prefix code.
A Rust encoder builds packets and standalone HTML; a plain JS decoder needs
neither Wasm nor decompression. The existing Pair/ANS/Windows format and its
BLAKE3 defaults remain unchanged. This raw transport has no checksum or digest.

## Matched results

The same 1 MiB binary input, without integrity verification, on Linux aarch64:

| Implementation | Payload bytes | Overhead | Chromium 156 | Chrome 109 |
| --- | ---: | ---: | ---: | ---: |
| Native Base64 / `atob` fallback | 1,398,104 | 33.334% | 1.015 ms | 14.830 ms |
| Fastest tested Base122: block path | 1,198,373 | 14.286% | 4.220 ms | 5.160 ms |
| Base122 upstream reference | 1,198,373 | 14.286% | 5.410 ms | 7.670 ms |
| Base122 with exact-size allocation | 1,198,373 | 14.286% | 6.420 ms | 8.065 ms |
| New portable prefix build | 1,195,879 | **14.048%** | **5.005 ms** | **7.095 ms** |
| Prefix literal profile, broader build | 1,193,832 | **13.853%** | 5.240 ms | 7.210 ms |
| Arithmetic candidate | about 1,170,479 | about 11.63% | 130.865 ms | 132.545 ms |

The portable build is **26.1× faster** than the arithmetic candidate in this
Chromium 156 campaign. It takes 18.6% more time than the fastest tested Base122
decoder while checking symbols, length and padding and returning a fresh,
exactly sized buffer. Some peers skip structural checks or return a view over
a larger backing buffer. Base122's exact-size variant makes a counting pass.
All tested variants recover identical bytes; their validation policies differ.

The portable ESM is **2,154 bytes**, its classic build **2,175 bytes**, and its
lookup table **8 KiB**. Only the selected loop is bundled. The default build
rejects omitted profiles before output allocation.

For this input, automatic masking produces a 1,195,864-byte packet. Complete
standalone HTML, including code, metadata, BOM and data, is **1,198,136 bytes**.
The tested Base122 HTML files are 1,198,781 bytes with the compact upstream
decoder, 1,198,978 with the inline decoder and 1,199,324 with the faster block
decoder. The **645-byte** saving over the smallest of these is modest but
survives inclusion of the decoder. Timings use mask zero; the HTML example uses
automatic masking. Small files still pay for framing: no claim is made that
every possible complete file beats Base122.

## Compatibility

The default portable profile uses 118 ASCII characters and 1,540 assigned
two-byte Unicode scalars. It excludes NUL, CR/LF, DEL/C1, all three quote
delimiters, backslash, dollar and less-than, combining marks, Unicode format
characters, unassigned code points and supplementary scalars. The header and
body fit directly into all three JS quote styles and inert script-data blocks.
No NUL substitution, HTML guards, surrogate reconstruction or `${` escaping
is needed. The slightly denser literal profile does not promise NFC stability.

The frozen portable alphabet is NFC-stable. Both browsers preserve all
**2,748,964 ordered character pairs** and complete encoded packets. Decoding
does not depend on Unicode property APIs or normalization tables. NFD/NFKC and
arbitrary sanitizers are different requirements and are not promised. Other C0
controls remain, as in Base122; this is not universally printable JSON/URL/XML
text. Excluding every control would lose the capacity needed to beat Base122.

Chrome **109.0.5414.119** and Chromium **156.0.8078.79** pass actual offline
`file://` checks with Wasm, `DecompressionStream` and runtime fetch disabled.
Tests cover script data, single/double/backtick literals and 1 MiB/10 MiB native
HTML output. HTML includes a three-byte UTF-8 BOM; both browsers also load it
correctly when the server deliberately labels it Windows-1252. The BOM is
document framing, not part of the raw transport string. Firefox and WebKit
were unavailable and were not tested.

## Why it is faster

An allowed ASCII value carries seven bits in one UTF-8 byte. A forbidden value
selects an escape class, followed by seven or eight more bits; its Unicode
symbol carries fourteen or fifteen bits in two UTF-8 bytes. The fifteen-bit
cases raise average capacity above Base122's seven bits per source byte.

Profile 5 has ten classes of 154 values. Truncated binary reads seven extra
bits for tails below 102 and eight for the rest. A 2,048-entry table stores the
bits and their 7/14/15-bit width. Fewer than eight carried bits remain between
characters, so at most 22 live bits require a 32-bit queue.

The selected loop specializes ASCII: an empty queue accepts seven bits;
otherwise exactly one output byte is ready and the shift decreases by one.
Every wide symbol yields one or two bytes. Padding is checked once afterward.
Invalid symbols are rejected, allocation is bounded before decoding, and XOR
unmasking is fused with output stores. There is no per-bit arithmetic loop.

The Rust encoder reads whole bytes, reserves its output once and uses direct
prefix lookup. Mask selection ranks all 256 masks on a bounded sample, then
recounts four finalists and mask zero on the entire input. It cannot enlarge
the unmasked prefix encoding and does not build 256 full strings.

The wire header is `~u1`, a profile digit, two mask digits, then a canonical
base-32 varint length, using URL-safe Base64 digits. The body is zero-padded
only within its final symbol. This is separate from GlyphPack's `binary()` API.

## Build and use

From the repository root with the documented tool environment:

```sh
cargo run --release --locked --example utf8_prefix -- encode input.bin payload.txt
cargo run --release --locked --example utf8_prefix -- build decoder.mjs
cargo run --release --locked --example utf8_prefix -- html input.bin output.html

# Denser literal profile, without NFC guarantees:
cargo run --release --locked --example utf8_prefix -- html input.bin literal.html --profile literal

# Include all experimental profiles instead of only portable:
cargo run --release --locked --example utf8_prefix -- build broader.mjs --all-profiles
```

```js
import {decode, warmup} from './decoder.mjs';
warmup(); // Optional; decode also prepares its table automatically.
const bytes = decode(encodedText);
```

The HTML sets `globalThis.unpacked` to the original bytes. Compressed input
remains compressed. `--mask 0..255` fixes the mask; `--classic` builds a global
`UTF8Prefix` script. The raw payload file has no document BOM.

## Evidence and reproduction

Three fresh processes per browser, nine rotated measured batches, identical
1 KiB/64 KiB/1 MiB inputs and warmed entry points. Timers include fresh outputs
and all Wasm transfers. Encoding, loading, HTML parsing, import and SHA-256
correctness comparisons are excluded. This unpinned-host measurement describes
warm batch throughput, not page startup or individual-call tail latency.

Screening covers table/scalar loops, ASCII branches, block stores, deferred
character checks and a Rust/Wasm kernel with four/eight-character bulk stores.
The ordinary JS loop wins in the latest target browser. Wasm's transfer costs
erase its kernel gain there. Deferred checks help Chrome 109 but slightly
regress Chromium 156 and duplicate the table in the prototype; they are kept
as research rather than selecting engines by unrelated feature heuristics.

[Small CSV](../benchmarks/results/utf8-prefix/summary.csv),
[all selected sizes/times](../benchmarks/results/utf8-prefix/sizes-and-times.csv),
[raw batches](../benchmarks/results/utf8-prefix/decode.csv),
[candidate screen](../benchmarks/results/utf8-prefix/screen.csv),
[compatibility](../benchmarks/results/utf8-prefix/compatibility.json), and
[10 MiB verification](../benchmarks/results/utf8-prefix/large.json)
retain results separately, with hashes and environment data in the JSON files.
The [research directory](../benchmarks/experiments/utf8/README.md) maps the source
and gives complete reproduction commands.
