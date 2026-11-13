# GlyphPack UTF-8 raw transport

`glyphpack/utf8-raw` encodes arbitrary bytes for ordinary **UTF-8** HTML. It is a
dependency-free JavaScript decoder with a Rust encoder. Its wire identifier is
`~u2`; it is separate from the UTF-16 pair/ANS and Windows codecs, and from the
older `~u1` research format.

This entry point is explicitly **raw transport**, like Base122: it validates
structure, characters, length and padding, without a checksum or cryptographic
digest. The existing package entry points retain their BLAKE3 defaults. This
format cannot replace an application signature, MAC, or integrity requirement.

## Use

```js
import {decode, warmup} from 'glyphpack/utf8-raw';
warmup(); // Optional, idempotent; initializes a 4 KiB table.
const bytes = decode(encodedText); // Synchronous, fresh exact-sized buffer.
```

There is no Wasm, `fetch`, decompression stream, engine detection or runtime
benchmark. The source targets Chrome 109+. The browser tests cover Chrome 109
and Chromium 156 on Linux aarch64; other browsers have not been measured.

From a checkout with the documented build prerequisites installed:

```sh
cargo run --release --locked --example utf8_raw -- encode input.bin packet.txt
cargo run --release --locked --example utf8_raw -- html input.bin standalone.html
cargo run --release --locked --example utf8_raw -- build decoder.mjs
cargo run --release --locked --example utf8_raw -- build decoder.js --classic
```

`html` embeds the decoder and payload in a UTF-8 document with a BOM and meta
charset. Open it directly under `file://`; decoded bytes are exposed as
`globalThis.unpacked`. It does not need a server or companion file. Encoding
selects an XOR mask automatically; append `--mask 0` for deterministic unmasked
comparison, or another byte value for an explicit mask. All masks take the same
decoder path. `build --all` also emits readable/minified ESM and declarations
under `dist/utf8-raw*`.

The small [ready-built offline example](../dist/utf8-raw-standalone.html) displays
decoded Unicode text using the same decoder and UTF-8 framing.

The Rust library API is `utf8_raw::encode(bytes, mask)`,
`utf8_raw::select_mask(bytes)` and `utf8_raw::script_literal(text)`. The encoder
and HTML-literal escaping are independent. Mask selection samples at most
4 KiB to rank all 256 masks, then completely scores four finalists and mask
zero. It never chooses a larger body than mask zero, but does not promise the
global optimum among all masks for large inputs.

## Packing and compatibility

Allowed ASCII symbols carry seven source bits. The six forbidden values are
NUL, LF, CR, double quote, ampersand and backslash, matching Base122. A forbidden
seven-bit prefix plus **eight** additional source bits maps to one of 1,536
assigned, NFC-stable, two-byte Unicode symbols. Base122 instead carries seven
additional bits there.

For uniform independent random bytes, expected asymptotic file expansion is

```text
8 * (1 + 6/128) / (7 + 8*6/128) - 1 = 13.5593%
Base122: 8/7 - 1                         = 14.2857%
```

These are UTF-8 byte counts, not JavaScript string lengths. Actual data, masks,
framing, tail padding and container escaping affect the result. The maximum
body expansion remains 14.286%, plus constant framing/padding overhead; small
files can lose once their decoder is included. Compress source data first when
that gives a useful size reduction; raw transport is not compression.

Wide symbols exclude C1 controls, combining marks, format characters, unassigned
characters and supplementary scalars. Ordered alphabet-pair tests check NFC
stability. **ASCII C0 controls other than the six exclusions, and DEL, remain
allowed**, as with Base122. This is a binary transport, not displayable prose.
NFKC normalization and arbitrary text cleanup are not supported.

Use a **double-quoted JavaScript literal** and the supplied Rust
`script_literal()` for inline HTML. It escapes `<!--` and case-insensitive
`<script` / `</script` prefixes, including the HTML tokenizer's double-escaped
state. The decoded packet is unchanged. It also handles ordinary JS escapes
when given arbitrary non-packet strings. Packets are not raw JSON, URL, HTML
attribute, template-literal, or inert-script content; use the appropriate
container escaping rather than inserting them verbatim.

## Wire and decoder

The header is ASCII `~u2`, two URL-safe-base64 alphabet digits representing the
XOR byte (low six bits, then high two), and a canonical base-32 length varint
using the same alphabet. Varint bit 5 is continuation; low five bits carry the
next length digit, least significant first. The length is the original byte
count. At least six header characters are present, including for empty input.

XOR the input with the mask and read most-significant bits first. For each
seven-bit prefix, emit it directly unless forbidden. A forbidden prefix at
index `k` in `[0,10,13,34,38,92]` consumes eight more bits and selects alphabet
entry `256*k + tail`. The alphabet is the first 1,536 scalar values enumerated
by the frozen half-open ranges in
[`alphabet.rs`](../src/utf8-raw/alphabet.rs). Pad the last symbol with zero bits;
stop after the symbol that first covers the original bit length. Zero input
bytes produce no body. The decoder rejects extra complete symbols, nonzero
padding, invalid symbols, noncanonical headers and insufficient body bits.

The JavaScript lookup stores 15 data bits and a sign-bit validity flag in each
`Int16` entry. Both symbol widths, 7 and 15, are congruent modulo 8. Every eight
symbols therefore end byte-aligned: the bulk loop uses constant shifts without
a variable-width reservoir. Its bound reserves the maximum possible 15 output
bytes before a lap; the tail guards stores and validates the final padding.
This avoids even ignored out-of-bounds writes that can hurt older V8 feedback.

Every declared length is checked before allocation, including a 1 GiB cap and
the physical bound of 15 bits per available body character. `decode()` returns
an owned exact-sized `Uint8Array`; later calls cannot overwrite earlier output.
Header/length checks do not establish data integrity; changing valid data can
still produce a structurally valid different payload.

## Measurements and reproduction

The [compatibility record](../benchmarks/results/utf8-rival/compatibility.json)
includes artifact hashes, offline HTML tests, a 10 MiB native export, deliberately
hostile script sequences, malformed headers/body/padding, all 256 masks, owned
buffer lifetime, NFC pair tests, and a mislabelled HTTP charset test. Wasm,
decompression streams and runtime network access are disabled for file tests.

The [decode report](../benchmarks/results/utf8-rival/report.md) compares complete
warm decode calls and complete HTML byte counts. Base122 competitors include
the upstream-derived reference, an independent fork, and local optimized loops.
The constant-shift insight was applied to **both formats**, rather than leaving
Base122 on its slower original implementation. Base122 is permitted its usual
unchecked decoding and oversized backing-buffer view; this decoder includes
validation and returns exact owned output. Neither side computes a digest.

```sh
cargo run --release --locked -- bench prepare --quick
cargo run --release --locked --example utf8_raw_fixtures
cargo build --release --locked --example utf8_raw
node benchmarks/utf8-rival-verify.cjs
RIVAL_RUNS=3 RIVAL_ROUNDS=9 RIVAL_LABEL=final \
  RIVAL_VARIANTS=utf8-raw,utf8-unroll,base122-groupUnroll,base122-blockStores,base122-inline122,base122-block122,base122-reference,base122-fork \
  node benchmarks/utf8-rival.cjs
node benchmarks/utf8-rival-report.cjs
```

The drivers use `/usr/bin/chromium` and `.tools/chromium109/chromium`. Each
campaign uses three fresh processes per browser, rotated candidate/batch order,
warm-up, nine measured batches and output hashing outside timing. Valid fixtures
are checked before timing; malformed-input tests run in separate processes to
avoid contaminating V8 feedback. The host is unpinned, so the report retains
process ranges and raw samples. Timings exclude import, HTML parsing and encoder
work; file compatibility and byte size are measured independently. No claim is
made to have proven the globally fastest Base122 decoder or all-engine speed.

Implementation: [`src/utf8_raw.rs`](../src/utf8_raw.rs),
[`src/utf8-raw/`](../src/utf8-raw/), and the small
[`native CLI`](../examples/utf8_raw.rs). Previous version-1 experiments remain
available for reproducibility; their results should not be attributed to `~u2`.
