# Configuring GlyphPack

The build selects which codecs and policies exist. A packet's indicator selects
its codec at runtime. A build rejects packets for codecs it does not include.
The full build includes five codecs and all 12 verification/memory combinations
per codec. There is no legacy packet detection or compatibility switch.

## Ready-made npm imports

```js
import {binary, warmup} from 'glyphpack'; // Secure pair, fixed policies.
// Or: import {binary, warmup} from 'glyphpack/full';
const bytes = binary(payload); // Owned Uint8Array; ready synchronously after import.
```

| Import suffix | Codecs | Format | Integrity | Pair memory |
| --- | --- | --- | --- | --- |
| Root or `/recommended` | pair | on | secure | off |
| `/recommended-full` | pair, ans | on | secure | off |
| `/ans`, `/windows`, `/utf8`, `/utf8-compact` | named codec | on | secure | off |
| `/full` | all five | on/off | secure/fast/none | off/on |
| `/high-memory` | pair | on | secure | on |
| `/fast-none` | pair | on/off | fast/none | off |
| `/none` or `/core` | pair | off | none | off |

Each import has matching declarations. Fixed policies do not expose a runtime
option that could silently change or disable them. `/utf8-raw` is a separate bare
transport API with `decode(text)` and `warmup()`, structural checks and no digest;
it does not accept framed `binary()` packets.

## Custom decoder builds

Build from the matching source checkout. Install Node 20+, run `npm ci`, and
install Rust with `wasm32v1-none` (plus `wasm32-unknown-unknown` for the workbench).
CI uses Rust 1.99.1. The native library's minimum Rust version is 1.85.

```sh
rustup target add wasm32v1-none wasm32-unknown-unknown
npm ci
cargo build --release --locked

# Recommended pair + ANS, strict BLAKE3, no larger pair cache:
target/release/glyphpack build --packing pair ans \
  --types decoder.d.mts -o decoder.mjs

# Two UTF-8 codecs, all three integrity choices and both format policies:
target/release/glyphpack build --packing utf8 utf8-compact \
  --format on off --data secure fast none --types utf8.d.mts -o utf8.mjs

# Small trusted-data pair build, without hash implementations or format checks:
target/release/glyphpack build --packing pair --format off --data none -o trusted.mjs

# Every codec and every runtime choice, including pair memory optimization:
target/release/glyphpack build --full --types full.d.mts -o full.mjs
```

| Flag | Values | Default |
| --- | --- | --- |
| `--packing` | Any nonempty subset of `pair ans windows utf8 utf8-compact` | pair |
| `--format` | `on`, `off`, or both | on |
| `--data` | Any nonempty subset of `secure fast none` | secure |
| `--memory-heavy` | `off`, `on`, or both | off |
| `--compact-hash` | Smaller scalar BLAKE3 tail/tree code; same digest and SIMD bulk path | off |
| `--readable` | Skip minification | off |
| `--types path` | Write declarations matching exactly this build | omitted |
| `-o path` | Output module path | stdout |

One value fixes an axis and removes its runtime dispatch. Multiple values include
only those handlers. Defaults prefer secure integrity, strict format and memory
off when available; otherwise the build uses an included policy. `--full` selects
every policy and cannot be combined with explicit format/data/memory subsets.
It can be narrowed with `--packing`. `--all` writes the standard `dist/` profiles
and declarations; use individual builds for custom policies or compact hash.

## Runtime verification

For builds exposing these options:

```js
const bytes = binary(payload, {
  verifyFormat: true,
  verifyData: 'secure', // true = secure; 'fast' = XXH32; false/'none' = no check.
  memoryHeavy: false,
});
```

Format checks reject invalid characters, padding and noncanonical representations.
Integrity checks verify the decoded bytes and require the packet's stored digest
kind to match. BLAKE3 is a cryptographic unkeyed digest, not a signature or MAC;
XXH32 is a noncryptographic checksum. With format checks disabled, different text
can represent the same verified bytes. Keep both checks for untrusted input.
Mandatory allocation, input-capacity, trailer and algorithm-state bounds remain
in every build, including `/none`.

## Warm-up and memory

```js
warmup(); // Exactly one included codec, memory off.
warmup(['ans', 'pair'], [false, true]); // Parallel lists, optional second list.
warmup(['utf8', 'utf8-compact']); // Missing flags default to false.
warmup([]); // Deliberately warm nothing.
```

No arguments choose the first available codec in `pair > ans > windows > utf8 >
utf8-compact` order. Decode warms its selected path automatically. Warm-up validates
the selected build's codec and memory policies; it cannot enable omitted code.
Only pair has the extra 256 KiB lookup. Other codecs accept boolean flags without
allocating a larger optimization table. Warm-up initializes reusable caches, not
payload-sized buffers, and does not promise that the engine has compiled a JIT tier.

Required Wasm is embedded, gzip-compressed and imported once using native browser
APIs. No runtime downloads are needed. Fast UTF-8 uses the measured faster JS
transport path, with Wasm for verification when selected. Decode returns an owned
buffer which remains valid across subsequent calls.

## HTML and file://

Use the workbench's standalone export, `dist/standalone.html`, or the CLI injector
for offline pages. They embed modules and payloads in the document; exports use
Blob imports to work with `file://`. Separate ESM files obey browser origin rules.
Pair and ANS need UTF-16LE source bytes for their density benefit; Windows needs
Windows-1252. The two UTF-8 codecs work in UTF-8 documents. A document has one
charset. Read the payload element's exact `textContent`: never trim or normalize.
See [CLI encoding/injection](cli.md) and the [payload contract](format.md).
