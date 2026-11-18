# GlyphPack

Dense binary payloads for standalone HTML. **NeoX · 0BSD · 1.0.0.**
Rust encodes and builds; selected JS/Wasm paths decode. Chrome 109+ is the browser
baseline; performance is measured on Chromium 156.0.8078.79.

Try the [offline-capable workbench](https://neo-x-minecraft.github.io/glyphpack/),
install the [npm decoder package](https://www.npmjs.com/package/glyphpack), or get
the native CLI and browser archives from [GitHub releases](https://github.com/Neo-X-Minecraft/glyphpack/releases).
1.0.0 establishes a new format/API baseline; earlier payloads are unsupported.

```sh
npm install glyphpack
```

The package contains ready-to-import decoders and TypeScript declarations, with
no runtime dependencies. Rust encodes payloads; use the CLI or workbench to create
them. The default import supports pair with strict format and BLAKE3 checks fixed
on. Import `glyphpack/full` when you need every codec and runtime option.

| Packing      | Document encoding | Use                                       |
| ------------ | ----------------- | ----------------------------------------- |
| pair         | UTF-16LE          | Small framing and fast decode             |
| ans          | UTF-16LE          | Dense larger payloads                     |
| windows      | Windows-1252      | Highest density with a controlled charset |
| utf8         | UTF-8             | Fast Base122 alternative                  |
| utf8-compact | UTF-8             | Finite-state ANS for higher density       |

Fast UTF-8 has about 13.56% random-data overhead; compact UTF-8 about 11.81%.
These are transports, not compressors. Compact chooses the smaller current ANS
or fast representation. One document has one charset; transcoding changes density.

```js
import { binary, warmup } from "glyphpack/full";
warmup(["ans", "pair"], [false, true]); // Optional aligned lists.
const bytes = binary(payload, {
  verifyFormat: true,
  verifyData: "secure", // BLAKE3; also fast=XXH32, none, true/false aliases.
  memoryHeavy: false,
});
```

Defaults are strict format, BLAKE3 and memory false. Allocation, input-capacity,
trailer and algorithm-state bounds are mandatory. Only pair uses the optional
256 KiB lookup. Output buffers are owned. An unkeyed digest checks bytes, not
authorship or encoded-text spelling.

Warm-up without arguments selects exactly one available codec in pair > ans >
windows > utf8 > utf8-compact order, memory false. Decode initializes caches
itself. Compact ANS is tableless; its adaptive fast representation shares a 4 KiB
lookup. Warm-up does not promise a JIT tier or reserve payload-sized arenas.

Full builds handle all five codecs, all three integrity modes, both format
policies and both pair memory strategies. Custom builds erase unselected code.
Recommended profiles remain pair-only or pair+ANS with both checks fixed on.
See the [configuration guide](docs/configuration.md) for package imports, build
flags, runtime policies and warm-up examples, and [runnable samples](examples/).

```sh
# From a source checkout, after npm ci and installing the Wasm targets:
cargo run --release --locked -- build --all
cargo run --release --locked -- build --full -o full.mjs
cargo run --release --locked -- build --packing utf8 utf8-compact -o utf8.mjs
cargo run --release --locked -- encode input.bin --packing utf8-compact -o payload.gp8
cargo run --release --locked -- inject template.html payload.gp8 standalone.html
```

Required Wasm is embedded as Zopfli-optimized gzip/base64 and loaded once through native
DecompressionStream. Decode is synchronous after import. Fast-UTF-8-only hashless
builds omit Wasm. The current standalone `glyphpack/utf8-raw` leaf exposes
`decode`/`warmup` for bare fast transport; full builds expose only `binary`/`warmup`.

Standalone HTML supports file:// with an inline Blob-imported module, as in
`dist/standalone.html` and workbench exports. Separate module files follow browser
origin rules. The injector handles safe HTML data containers and native charsets;
read exact textContent without trimming or normalization. The workbench uses
local files and uploads nothing.

Build prerequisites: Rust 1.85+, wasm32v1-none and wasm32-unknown-unknown, Node 20+,
npm ci. CI pins Rust 1.99.1.

```sh
npm test
npm run test:types
npm run test:package
npm run test:examples
npm run test:integration
npm run build:site
npm run test:site
```

[Format](docs/format.md) · [CLI](docs/cli.md) · [Configuration](docs/configuration.md) · [Source map](docs/source-map.md) ·
[Measurements](benchmarks/results/integration/report.md) ·
[History](docs/history.md) · [Refinement results](benchmarks/results/refinement/report.md) ·
[Release notes](CHANGELOG.md).
