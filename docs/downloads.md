# Start with GlyphPack

By NeoX · 0BSD · https://github.com/Neo-X-Minecraft/glyphpack

Try the local-file workbench at https://neo-x-minecraft.github.io/glyphpack/.
It encodes files, previews bytes, and exports self-contained HTML viewers.

## Open directly from disk

Download `standalone.html`, or open `dist/standalone.html` from the web ZIP.
It is a complete offline HTML example with inline code and embedded Wasm. It
works under `file://` with no server, headers, or file-access exceptions.
For your own local-file viewer, embed the module as that example does, or use
the workbench's standalone HTML export; separate ESM files follow browser module
loading rules.

## Browser modules

- `default.min.mjs`: pair codec, fixed BLAKE3 integrity and format checks.
- `recommended.min.mjs`: identical to default; pair only, both checks fixed on.
- `recommended-full.min.mjs`: pair + ANS, both checks fixed on.
- `ans.min.mjs`, `windows.min.mjs`: secure single-codec alternatives.
- `full.min.mjs`: all three codecs and all 12 verification/lookup combinations.
- `core.min.mjs`: mandatory allocation bounds, without optional verification.
- The web ZIP includes every readable/minified profile, examples and docs.
- `glyphpack-full.wasm` is the raw full decoder for custom host integration.
  Most users should import an ES module instead.

```js
import {binary} from './full.min.mjs';
const bytes = binary(payload);
```

Import initializes embedded gzip/base64 Wasm once. `binary()` is synchronous
afterward. No companion Wasm fetch is needed. Target: Chrome 109+.
Default options: format on, BLAKE3 on, heavy lookup off. New encodings carry a
codec indicator; modern pair-capable decoders also accept unmarked format-3 data.

Recommended profiles omit heavy lookup. Use a custom build with
`--memory-heavy off on` to include it. Every module exports `warmup()` (first
available codec in pair > ANS > Windows order, memory false), or
`warmup(['ans','pair'],[true,false])` for explicit aligned lists. Only pair uses
the memory flag; ANS and Windows ignore it.

The npm tarball can be installed directly with `npm install ./glyphpack-0.2.2.tgz`;
it contains the same modules and specialized TypeScript declarations.

## Native tools and results

Linux x86_64 and aarch64 musl archives contain a static native CLI, its commit,
and licenses. Encoding and injection work from any directory. Other build
commands need a matching checkout. See the archive README.

The benchmark archive contains actual measurements, environment details,
methodology and compact CSV/SVG reports. Results describe specific hosts and
browser versions; they are not universal performance guarantees.

Verify downloads with `sha256sum -c SHA256SUMS`. Use GitHub's source archive
for the Rust encoder, injector, specialized decoder, tests and build tooling.
