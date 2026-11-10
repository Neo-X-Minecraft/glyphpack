# Start with GlyphPack

By NeoX · 0BSD · https://github.com/Neo-X-Minecraft/glyphpack

Try the local-file workbench at https://neo-x-minecraft.github.io/glyphpack/.
It encodes files, previews bytes, and exports self-contained HTML viewers.

## Browser modules

- `default.min.mjs`: fixed BLAKE3 integrity and format checks; recommended.
- `full.min.mjs`: all 12 combinations of integrity, format and lookup policy.
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
Default options: format on, BLAKE3 on, heavy lookup off. The wire format and
public decoder API are unchanged from v0.1.0.

## Native tools and results

Linux x86_64 and aarch64 musl archives contain a static native CLI, its commit,
and licenses. Encoding and injection work from any directory. Other build
commands need a matching checkout. See the archive README.

The benchmark archive contains actual measurements, environment details,
methodology and compact CSV/SVG reports. Results describe specific hosts and
browser versions; they are not universal performance guarantees.

Verify downloads with `sha256sum -c SHA256SUMS`. Use GitHub's source archive
for the Rust encoder, injector, specialized decoder, tests and build tooling.
