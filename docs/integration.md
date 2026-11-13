# Five-codec integration

This is the local, unpublished integration of the selected UTF-8 decoder into
GlyphPack format 4. The actual complete ES module is `dist/full.min.mjs`;
there is no separate `full.min.js` or classic-script build of the full decoder.
`dist/full.mjs` is its readable generated counterpart. Native sources, browser
adapters and tests remain separate; the distribution is bundled for embedding.

## Selected transports

| Builder name   | Physical source encoding | Implementation    | Intended tradeoff                                                                     |
| -------------- | ------------------------ | ----------------- | ------------------------------------------------------------------------------------- |
| `pair`         | UTF-16LE                 | Rust/Wasm         | Small framing, fast decoding                                                          |
| `ans`          | UTF-16LE                 | Rust/Wasm         | Denser than pair for larger payloads                                                  |
| `windows`      | Windows-1252             | Rust/Wasm         | Highest source density, single-byte container constraints                             |
| `utf8`         | UTF-8                    | JavaScript        | Fast Base122 rival; 13.56% expected random-byte expansion                             |
| `utf8-compact` | UTF-8                    | JavaScript BigInt | Size-first enumerative packing; about 11.77% expansion on the measured random fixture |

Windows-1252 is a single-byte charset, not UTF-16 or a Windows-only requirement.
One document has one charset. A mixed decoder accepts all five logical strings;
that does not preserve a payload's native byte density after transcoding it.
Compress compressible data before packing when appropriate.

The compact codec enumerates strings by actual UTF-8 byte cost in fixed 4 KiB
input blocks. Its counting model uses 126 one-byte, 1,920 two-byte, 61,406
three-byte and 1,048,544 four-byte symbols. It excludes NUL, CR, surrogates and
Unicode noncharacters. It can contain controls, combining marks and unassigned
characters. Ordinary UTF-8 HTML and Chrome 109+ support these; Unicode
normalization, text sanitizers, URLs and JSON require their own handling.
It is not a compression algorithm for redundant input. The encoder compares
its enumerative representation with a guarded fast representation and emits the
smaller actual UTF-8 string. Both are supported by the compact decoder.

The compact dynamic-programming model grows lazily to the largest needed block,
using roughly 9 MiB of BigInt digit storage at the full 4 KiB block size, plus
engine object overhead. Its multi-second-per-MiB decoding is an explicit
size-first tradeoff. Fast UTF-8 needs only a 4 KiB lookup table.

## Public API and verification

```js
import { binary, warmup } from "./full.min.mjs";
warmup(); // pair only, heavy memory false; safe available-codec priority
warmup(["utf8", "ans", "pair"], [false, false, true]);
const bytes = binary(payload, {
  verifyFormat: true,
  verifyData: "secure",
  memoryHeavy: false,
});
```

The payload indicator selects its codec; no runtime packing option is needed.
Full builds include all 12 format/data/memory combinations per codec:

- Format verification: `true` or `false`.
- Data verification: `secure` / `true` (BLAKE3-256), `fast` (XXH32), or
  `none` / `false` (no digest verification).
- Memory lookup: `false` or `true`. Only pair uses the optional 256 KiB table;
  the other four codecs accept and ignore this flag.

Defaults remain **format true, BLAKE3, memory false**. BLAKE3/XXH32 trailers
cover the original bytes before XOR masking, exactly as for the established
codecs. UTF-8 unpacking produces stored bytes in JS; checked calls copy those
bytes once into the existing Wasm input arena and call the shared hash verifier.
No hash code is duplicated in JavaScript. No-check calls skip that copy and
verifier. Returned bytes have an owned buffer and survive later calls.

Every decoder retains finite length, allocation-cap, available-input and
minimum-trailer guards. Format-off does not mean arbitrary allocations are
trusted. Format verification adds symbol/padding rules; it does not provide a
signature. An unkeyed BLAKE3 digest detects corruption of decoded bytes but does
not authenticate an attacker-controlled payload and digest together.

All headers carry their stored integrity kind. Requesting secure or fast
verification requires a matching trailer; requesting none strips any declared
trailer without checking it. Incorrect checksums/digests throw the existing
`Payload checksum mismatch` / `Payload digest mismatch` errors.

`warmup(names?, flags?)` always accepts up to two optional arrays. No arguments
selects exactly one available codec in `pair > ans > windows > utf8 >
utf8-compact` order, always memory false. Supplied flags correspond by position;
omitted flags are false. Decode auto-initializes its selected path. Compact
warm-up prepares both its enumerative table and its fast internal alternative.

## Wire dispatch and existing packets

Existing indicators and pair/ANS/Windows packets are unchanged. New frames are:

```text
U+000B + ASCII integrity digit 0/1/2 + bare ~u2 packet     (utf8)
U+000E + ASCII integrity digit 0/1/2 + ~c1 or guarded ~u2  (utf8-compact)
```

The inner headers retain their mask byte and declared stored length. Compact
`~c1` blocks are enumerative ranks, with zero-based base-32 varint length and
bytewise XOR. Three U+0001 guards are inserted after `<` before critical script
transitions, and before naturally occurring guard runs, then reversibly removed
by the decoder. Strict mode checks their spelling. This prevents `</script>`,
`<script` and `<!--` from changing the inert-script parser state.

Modern full builds still accept unmarked format-3 pair packets. Bare `~u2`
is deliberately not auto-detected by `binary()`: it could collide with an old
unmarked pair header. Full exports `decodeRawUtf8(text)` and
`decodeRawUtf8Compact(text)` as explicit strict, no-digest entry points. These
helpers appear only in builds selecting the relevant codec, format-on and
no-integrity handling. The separate `glyphpack/utf8-raw` package preserves its
original `decode()` / `warmup()` API and bare wire representation.
Explicit historical `--legacy` pair mode remains a separate builder choice;
old research encodings are not production codecs.

## Select only what is needed

```sh
# Full five-codec, three-integrity, two-format, two-memory module.
glyphpack build --full -o full.min.mjs

# Both UTF-8 transports, fixed strict BLAKE3 policy.
glyphpack build --packing utf8 utf8-compact -o utf8-secure.mjs

# Only fast UTF-8, optional format policy, no Wasm or hashes at all.
glyphpack build --packing utf8 --format off on --data none -o utf8-raw.mjs

glyphpack encode input.bin --packing utf8 -o payload.gp8
glyphpack encode input.bin --packing utf8-compact -o compact.gp8
glyphpack inject template.html payload.gp8 standalone.html
```

Any nonempty subset is supported. Omitted codecs throw `Unsupported payload
codec` before decoding, regardless of verification flags. Unselected code,
lookup tables, hash kernels and option handlers are removed. Secure defaults
remain pair-only for `default`/`recommended` and pair+ANS for `recommended-full`.
Secure single-codec `utf8` and `utf8-compact` package exports are also provided.

The full module contains one embedded gzip-9/base64 Wasm member for the three
native codecs and shared hashes, JS UTF-8 unpackers, selected option dispatch,
and warm-up. It uses the faster expanded BLAKE3 implementation by default.
`--compact-hash` is a separate scalar-hash size tradeoff, unrelated to the
`utf8-compact` transport; it produces identical BLAKE3 digests.

The injector recognizes the new indicators and emits UTF-8 with BOM/meta. Fast
UTF-8 uses hidden textarea RCDATA, escaping ampersands and closing-textarea
prefixes only; `textContent` reconstructs the exact packet. Compact UTF-8 uses
its guarded inert script. Both work under `file://` with an inline Blob-imported
module and no network requests. Separate ESM files still follow normal browser
file-origin import restrictions. The workbench supports all five formats,
matching native file downloads, file imports and self-contained HTML exports.

## Current artifact sizes

| Module                     | File bytes |
| -------------------------- | ---------: |
| `default.min.mjs`          |      9,725 |
| `recommended-full.min.mjs` |     10,625 |
| `utf8.min.mjs`             |     10,155 |
| `utf8-compact.min.mjs`     |     12,312 |
| `utf8-raw.min.mjs`         |      2,365 |
| `full.min.mjs`             |     21,794 |

The full module is 21.28 KiB as an ES-module file. Its embedded native kernel is
28,789 bytes before compression, 10,355 bytes as gzip-9, and 13,808 base64
characters inside the module. Those embedded bytes are already included in the
module size, not an additional download. The table measures UTF-8 module files;
embedding their ASCII code in a UTF-16LE document doubles that code's source
bytes. Specializing to fewer codecs/policies reduces code size.

## Local validation and measurements

The reproducible fixture builder is `cargo run --release --locked --example
integration`. It generates synthetic/public data only, all 31 codec subsets,
and eight additional specialized builds. See the current
[measurement report](../benchmarks/results/integration/report.md) and
[compact CSV](../benchmarks/results/integration/summary.csv).

```sh
node tests/integration.cjs
node tests/integration-browser.cjs
node tests/integration-html.cjs
node benchmarks/integration.cjs
node benchmarks/integration-report.cjs
```

The browser checks run on Chromium 156.0.8078.79 and Chrome 109.0.5414.119.
They cover selected/omitted codecs, verification combinations, malformed
headers, integrity corruption, output ownership, no-Wasm specialization,
large packets and actual offline serialized HTML. The hostile-markup test
constructs encoded strings containing parser delimiters, rather than assuming
HTML in the original bytes produces those delimiters in the encoded text.
Benchmark import, encoding, warm-up and SHA-256 correctness work are outside
decode timers. Full call times include allocation, codec dispatch, JS/Wasm
copies and selected verification. Results are host-specific measurements.
