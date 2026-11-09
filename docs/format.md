# Format 3 and document embedding

The encoder and decoder share an ordered alphabet of **63,385 BMP code points**.
Each symbol occupies one UTF-16 code unit. Iterate code points 32 through 65,533
inclusive, excluding:

- `<` (60).
- 127–159, surrogate code points 55,296–57,343, and 64,976–65,007.
- BOM 65,279, line separator 8,232, and paragraph separator 8,233.

The radix is `R = 63385`. The packing threshold is
`R * R - 2147483649 = 1870174576`. Source files calculate this expression rather
than relying on a separately maintained literal.

## Stored bytes

The pipeline is:

```text
original bytes -> optional digest trailer -> bytewise XOR -> packed symbol pairs
```

The trailer is absent for `none`, four little-endian bytes for XXH32 (`fast`),
and 32 BLAKE3 bytes for `secure`. The digest covers the original unmasked bytes.
The mask applies to the entire stored buffer, including the digest.

## Header

Header entries below are alphabet indices, not Unicode code points. Let `N` be
the stored byte count, `q = floor(N / R)`, `r = N % R`, and
`settings = mask | (kind << 8)`, with kinds 0, 1 and 2 for none, XXH32 and BLAKE3.
Kind 3 is reserved.

| Condition | Header indices |
| --- | --- |
| `N < 32 * R` | `[settings + 1024 * q, r]` |
| Otherwise | `[32768 + settings, r, q]` |

`N` must be smaller than `R * R`. The stored length includes the trailer.
The body immediately follows the two- or three-symbol header.

## Pair packing

A little-endian bit queue emits either 31 or 32 low bits. If its low 31-bit value
exceeds the threshold, emit 31 bits; otherwise emit 32. For emitted value `v`,
the pair indices are `[v % R, floor(v / R)]`. A final partial pair is zero-padded.
Testing the **low 31 bits** is intentional even for a 32-bit value.

The native encoder uses a `u64` queue: at most 31 pending bits plus a 32-bit word.
The Wasm decoder carries at most seven pending bits. It retains low-word and carry
information separately so a conceptual 39-bit queue is never prematurely
truncated to 32 bits.

Decoding uses four-byte unaligned little-endian Wasm stores, including unaligned
positions after a narrow pair. A four-pair bulk loop removes repeated store
bounds branches; a separate tail handles short writes. The optional heavy table
precomputes high-digit contributions and dispatches outside the hot loops.

A build with no integrity verification still parses a declared trailer and
strips it. It rejects an impossible trailer length before allocation. All builds
also reject non-integer/negative lengths and declarations exceeding the input's
maximum byte capacity. Builds retaining either check additionally establish
actual decoded-byte coverage.

Format verification enforces symbol, header and padding rules. It does not
establish a unique representation across alternative valid XOR masks. With it
disabled, invalid or surplus symbols can sometimes leave the same decoded bytes;
a valid digest says nothing about the spelling of that encoded string.

## UTF-16LE HTML

The encoder's `dense16()`/default `encode` output is payload code units, with no
BOM. `encode_text()`/`encode --text` returns a UTF-8 host string representing the
same symbols. `utf16_document()` writes the whole document as UTF-16LE and prefixes
`FF FE`. The browser consumes that BOM before HTML tokenization.

Payloads exclude `<`, so they cannot introduce a script-end delimiter. Put them
in inert script data blocks and read `textContent` verbatim. Do not entity-escape,
normalize Unicode, trim whitespace, or transcode UTF-16LE bytes as UTF-8.

```html
<script id="payload" type="application/octet-stream">ENCODED_TEXT</script>
```

The generic injector validates attribute names, escapes attribute values, and
rejects payload text containing `<`. Marker replacement scans the original
template once, prefers longer overlapping markers, and never rescans insertions.

## Explicit legacy mode

The legacy header is `[N % R, floor(N / R)]`, with no mask or trailer. Select
`encode --legacy --checksum none` and `build --legacy --data none` explicitly.
There is no automatic format detection or runtime legacy branch. `FORMAT_VERSION`
is a source/cache identifier; it is not an additional wire field.

Production ESMs embed their decoder as native `gzip -9 -n` + base64. Native
`DecompressionStream` inflates it during asynchronous module evaluation. After
import completes, the public decode function remains synchronous.
