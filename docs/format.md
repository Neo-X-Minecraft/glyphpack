# GlyphPack 1.0.0 payload contract

Every binary() payload requires its current codec indicator. Unknown or omitted
indicators are rejected independently of verification. There is no predecessor
reader or unmarked fallback.

| Unit   | Codec        | Intended source |
| ------ | ------------ | --------------- |
| U+0009 | pair         | UTF-16LE        |
| U+000A | ans          | UTF-16LE        |
| U+000C | windows      | Windows-1252    |
| U+000B | utf8         | UTF-8           |
| U+000E | utf8-compact | UTF-8           |

Stored bytes are original data followed by an optional trailer, then XORed with
the mask. Kinds: 0 none, 1 little-endian four-byte XXH32, 2 BLAKE3-256. Digests
cover original bytes. Checked calls require a matching stored kind. None mode
skips verification and strips a declared trailer.

## Pair and UTF-16 ANS

R=63385. Walk BMP points 32..65533, excluding '<', 127..159, surrogates,
64976..65007, BOM 65279, and separators 8232/8233. Entries below are alphabet
indices. For N stored bytes, q=floor(N/R), r=N%R, settings=mask|(kind<<8):

- N < 32R: [settings+1024q,r].
- Otherwise: [32768+settings,r,q].

The codec indicator precedes that header. Pair emits 31 low bits if the low
31-bit queue value exceeds T=R\*R-2147483649, otherwise 32. Value v uses indices
[v%R,floor(v/R)]. A partial final pair is zero-padded.

ANS uses four interleaved states, B=16, L=2^31. Encode little-endian words in
reverse; normalize while x >= (L>>B)*R, then x=(x<<B)|word. Each final state uses
three radix-R digits, followed by reversed normalization digits. Decode low
16 bits and normalize with (x>>B)*R+digit. Terminal states equal L. An odd final
word has a zero high byte. Only pair uses the optional 256 KiB lookup.

## Windows-1252

R=254: source bytes 0..255 except CR and '<', in byte order. C1 bytes use the
Windows-1252 mapping. HTML's NUL replacement U+FFFD represents digit zero.
There are two settings digits, four length digits and four states of four digits
each. ANS uses B=8, L=2^23. Density benefits require this document charset; it
works across operating systems.

## UTF-8

After the indicator is an ASCII integrity digit. Fast transport uses a ~u2
header: two base64url mask digits, then a base-32 length varint. Allowed ASCII
carries seven bits. Forbidden prefixes 0/10/13/34/38/92 plus eight bits map to a
frozen assigned two-byte scalar. Eight symbols align on a byte boundary.

Compact accepts only current ~c2 ANS or guarded current ~u2 fast representation.
The encoder chooses the smaller actual UTF-8 string. ANS has the same mask and
length header, then seven little-endian base64url digits for a state below 2^38.
Q=2^23, L=2^30. Frequencies: first 110 ASCII digits 58821, remaining 16 digits
58820; 1920 two-byte scalars 413 each; 61406 three-byte scalars 3 each. They sum
to Q. ASCII excludes NUL/CR; three-byte scalars exclude surrogates/noncharacters.
Decode symbols and output bytes backwards. State bounds, exact coverage and
terminal L are mandatory. Strict mode also requires canonical stopping: the last
encoded symbol consumes an input byte. After normalization, state < F\*2^15 <
2^31 permits exact constant 32-bit division in the optimized native kernel.

## HTML and API

Pair/ANS/Windows exclude '<' and use inert script data. Compact inserts a triple
U+0001 guard after '<' before /script, script, !-- or natural guard runs. Removal
is reversible. Fast UTF-8 uses textarea RCDATA with ampersands and closing-textarea
prefixes escaped. Read exact textContent. Never trim, normalize or sanitize it.

Full exports binary(text,options?) and warmup(names?,flags?) only. Defaults are
strict format, BLAKE3, memory false. Warm-up with no arguments chooses one
available codec in pair > ans > windows > utf8 > utf8-compact order, memory false.
Only pair uses heavy lookup. Selected build subsets erase other handlers.

1.0.0 establishes the release baseline. Future compatibility work considers
published formats only. Unreleased experiments create no compatibility obligation.
Historical records may remain as data; retired implementations are removed.
