# Fast UTF-8 transport

This working experiment replaces the arithmetic loop with a small prefix code.
A Rust encoder builds packets and standalone HTML; a plain JS decoder needs
neither Wasm nor decompression. The existing Pair/ANS/Windows format and its
BLAKE3 defaults remain unchanged. This raw transport has no checksum or digest.

## Matched results

The same 1 MiB binary input, without integrity verification, on Linux aarch64:

| Implementation | Payload bytes | Overhead | Chromium 156 | Chrome 109 |
| --- | ---: | ---: | ---: | ---: |
| Native Base64 / `atob` fallback | 1,398,104 | 33.334% | 1.115 ms | 15.735 ms |
| Fastest tested Base122: block path | 1,198,373 | 14.286% | 4.545 ms | 5.450 ms |
| Base122 upstream reference | 1,198,373 | 14.286% | 5.745 ms | 8.100 ms |
| Base122 with exact-size allocation | 1,198,373 | 14.286% | 6.725 ms | 8.460 ms |
| Default prefix throughput build | 1,195,879 | **14.048%** | **4.770 ms** | 7.990 ms |
| Prefix `--balanced` build | 1,195,879 | **14.048%** | 5.640 ms | **6.365 ms** |
| Prefix literal profile, broader balanced build | 1,193,832 | **13.853%** | 6.000 ms | 7.015 ms |
| Arithmetic candidate | 1,170,479 | 11.626% | 138.265 ms | 140.925 ms |

The default build is **29.0× faster** than the arithmetic candidate in this
Chromium 156 campaign. It takes 5.0% more time than the fastest tested Base122
decoder while checking symbols, length and padding and returning a fresh,
exactly sized buffer. Some peers skip structural checks or return a view over
a larger backing buffer. Base122's exact-size variant makes a counting pass.
All tested variants recover identical bytes; their validation policies differ.
Chrome 109 has substantial process spread for the throughput build; raw ranges
are preserved in the CSV. Prefer `--balanced` for that target.

The portable ESM is **1,777 bytes**, its classic build **1,798 bytes**, and its
lookup table **8 KiB**. The balanced ESM is 1,781 bytes. Only the selected loop
is bundled; omitted profiles are rejected before output allocation.
The [optimization study](utf8-speed.md) separately compares the previous exact
artifact and nineteen implementation variants, with a six-row shareable CSV.

For this input, automatic masking produces a 1,195,864-byte packet. Complete
standalone HTML, including code, metadata, BOM and data, is **1,197,759 bytes**.
The tested Base122 HTML files are 1,198,781 bytes with the compact upstream
decoder, 1,198,978 with the inline decoder and 1,199,324 with the faster block
decoder. The **1,022-byte** saving over the smallest of these is modest but
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

The default loop keeps pending bits at the high end of a 32-bit register and
writes speculative bytes, then advances by the actual complete-byte count.
Unfinished stores are overwritten; tail stores beyond the declared output are
ignored. Character checks, bounded allocation and canonical padding checks
remain mandatory. XOR unmasking is fused with the stores. The optional balanced
loop specializes ASCII with a low-aligned queue and accumulates validity flags
for one final character check. Both keep at most 22 live bits and need no
per-bit arithmetic loop. See the [invariants and tradeoffs](utf8-speed.md).

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
cargo run --release --locked --example utf8_prefix -- build balanced.mjs --balanced
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

The current [nineteen-variant study](utf8-speed.md) covers table/scalar loops,
ASCII branches, speculative and block stores, deferred character checks, table
layouts and Rust/Wasm kernels with native UTF-8 input. The selected ordinary JS
loops avoid Wasm transfer and loader costs. Native Base64 remains substantially
faster on current Chromium, at higher transport overhead. No engine guessing
or runtime autotuning is added to the delivered files.

[Small CSV](../benchmarks/results/utf8-prefix/summary.csv),
[all selected sizes/times](../benchmarks/results/utf8-prefix/sizes-and-times.csv),
[raw batches](../benchmarks/results/utf8-prefix/decode.csv),
[candidate screen](../benchmarks/results/utf8-prefix/screen.csv),
[compatibility](../benchmarks/results/utf8-prefix/compatibility.json), and
[10 MiB verification](../benchmarks/results/utf8-prefix/large.json)
retain results separately, with hashes and environment data in the JSON files.
The [research directory](../benchmarks/experiments/utf8/README.md) maps the source
and gives complete reproduction commands.
