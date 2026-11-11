# Format 4 and document embedding

## Codec field

The first code unit is a separate codec indicator, outside the older pair
alphabet. It is included in `encode_units`, `encode_text`, and binary outputs.

| Code unit | Codec | Source representation |
| --- | --- | --- |
| U+0009 (TAB) | `pair` | UTF-16LE; two source bytes |
| U+000A (LF) | `ans` | UTF-16LE; two source bytes |
| U+000C (FF) | `windows` | Windows-1252; one source byte |

These survive inert script raw-text parsing in Chrome 109 and current Chromium.
Read `textContent` without trimming. Each builder selects any nonempty subset;
an omitted codec always throws `Unsupported payload codec`, independently of
optional format/integrity checks. Dispatch occurs once per payload, before the
decode loop. Modern pair-capable builds also accept unmarked format-3 payloads
whose first unit belongs to the original alphabet. New encoders always emit the
field; old decoders cannot read these tagged packets.

## Pair/ANS alphabet

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
original bytes -> optional digest trailer -> bytewise XOR -> selected codec
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
The body immediately follows the two- or three-symbol header. The preceding
codec field is not part of these indices or the stored byte count.

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

The encoder's `dense16()` output is always UTF-16LE, with no BOM. `encode_bytes()`
and default CLI output use UTF-16LE for pair/ANS and Windows-1252 for Windows.
`encode_text()`/`encode --text` returns a UTF-8 host string representing the
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

## UTF-16 ANS

ANS uses the same alphabet, mask, digest and length header as pair, with its own
indicator. It encodes little-endian 16-bit words through four interleaved uniform
rANS states. An odd stored length has a zero high byte in its final word; that
synthetic byte is not masked or hashed.

Let `R = 63385`, `B = 16`, `L = 2^31`. Initialize four states to `L`, and visit
words in reverse order, selecting lane `wordIndex % 4`. While a state is at least
`(L >> B) * R`, push `state % R` and divide the state by `R`. Then replace it
with `(state << B) | word`. Write each final state as three little-endian radix-R
digits, followed by the reversed digit stack. States fit in 47 bits and use Wasm
integer arithmetic; no JavaScript BigInt or extra browser capability is needed.

The decoder visits words forwards: take the low 16 bits, then normalize using
`(state >> 16) * R + nextDigit`. If still below `L`, multiply by `R` and read
another digit. All four terminal states must equal `L`, and all digits must be
consumed. These structural and bounds checks remain mandatory when optional
format verification is off.

## Windows-1252 ANS

The alphabet consists of source bytes 0–255 excluding CR (13) and `<` (60), in
source-byte order: `R = 254`. Bytes 128–159 use the Windows-1252 Unicode mapping
in `src/packing.rs`. HTML replaces NUL with U+FFFD in script data, so the encoder
emits logical U+FFFD for the zero source digit. The decoder also accepts logical
NUL for direct TextDecoder callers. Neither text spelling is an authentication
claim.

After the indicator, the header is two little-endian radix-254 digits for
`settings = mask | (kind << 8)` and four for stored length. Four states follow,
each in four little-endian radix-254 digits, then the reversed digit stack.
The ANS procedure above uses bytes instead of words, `B = 8` and `L = 2^23`;
four states fit in u32. It enforces the same terminal-state and consumption rules.

Use `<meta charset="windows-1252">` near the start of the HTML and a matching
HTTP charset if served. The CLI's `inject --encoding windows1252` replaces
`__CHARSET__` and serializes the complete template to this encoding. Characters
outside it must be expressed as HTML entities or JS/CSS escapes. The injector
rejects unrepresentable template characters instead of silently losing them.
`--text` emits UTF-8 logical text, not a Windows-1252 document.

One file has one physical encoding. Mixed builds can decode all three logical
strings, including Windows payloads serialized in a UTF-16 container, but the
single-byte source-size benefit applies only to Windows-1252 containers.

## Explicit legacy mode

The legacy header is `[N % R, floor(N / R)]`, with no mask or trailer. Select
`encode --legacy --checksum none` and `build --legacy --data none` explicitly.
Legacy builds support only unmarked legacy pair data, and reject tagged modern
packets. This is separate from modern builds' format-3 compatibility.
`FORMAT_VERSION = 4` is a source/cache identifier; the wire field is the codec
indicator listed above, not an additional numeric version byte.

Production ESMs embed their decoder as native `gzip -9 -n` + base64. Native
`DecompressionStream` inflates it during asynchronous module evaluation. After
import completes, the public decode function remains synchronous.

## Warm-up API and ABI

All modules export `warmup(): void` when one codec is compiled, or
`warmup(codecs: readonly ('pair' | 'ans' | 'windows')[]): void` for a mixed build,
with the union narrowed to the selected codecs. Mixed builds require an explicit
array. Empty arrays do nothing; duplicates are idempotent. Unavailable or unknown
names throw `Unsupported payload codec` before any cache is initialized. An
argument that is not an array throws `TypeError('Expected an array of payload codecs')`.

The raw Wasm `warmup(mask: u32) -> status` export uses bits pair=1, ANS=2,
Windows=4. It validates every bit before changing state. Status 9 rejects unknown
or unavailable bits; status 8 reports allocation failure. Success is 0. Zero is
a no-op. A requested pair codec prepares its optional heavy table if compiled;
pair/ANS share the main lookup. This does not change input/output pointers or
lengths. Repeated warming never allocates the same cache twice.

Normal decoding still initializes only its needed tables lazily. Its default
memory strategy remains off; explicit pair warm-up in a heavy-capable build
intentionally prepares the extra 256 KiB cache without changing decode options.
Warm-up does not allocate payload-sized arenas or force V8 to optimize kernels.
