# GlyphPack

Dense binary payloads for standalone HTML, by **NeoX**, under **0BSD**.
Rust handles encoding, adaptive XOR mask selection, HTML insertion, builds and
benchmark preparation. A specialized Rust/Wasm decoder runs in the browser.

Every distribution module embeds its Wasm as **native gzip level 9 + base64**.
The browser's `DecompressionStream('gzip')` inflates it once during module import.
There is one production backend, with small JS glue for options and memory I/O.
Target: **Chrome 109+**.

[**Open the live workbench →**](https://neo-x-minecraft.github.io/glyphpack/) · [v0.2.0 measurements](docs/performance.md)

Try JSON, multilingual text, SVG, arbitrary bytes, gzip logs, and empty files.
The page encodes local files with Rust/Wasm, explains verification failures,
compares actual transport sizes, and exports offline HTML viewers. Nothing is
uploaded.

## Use a ready-built module

```js
import {binary} from './dist/full.min.mjs';

const bytes = binary(encodedText);
```

Import waits for decompression and Wasm instantiation. After import resolves,
`binary()` is synchronous, and the same instance, arenas and lookup tables are
reused. Returned bytes own a fresh buffer and remain valid across later calls.
Module initialization uses no network requests or neighboring files.

The full module supports all twelve combinations:

```js
binary(encodedText, {
  verifyFormat: true,
  verifyData: 'secure', // 'secure', 'fast', 'none'; true/false aliases
  memoryHeavy: false
});
```

| Option | Meaning |
| --- | --- |
| `verifyFormat` | Check symbols, header rules, decoded coverage and padding |
| `verifyData: 'secure'` | Require and verify BLAKE3-256 |
| `verifyData: 'fast'` | Require and verify XXH32 |
| `verifyData: 'none'` | Skip integrity verification |
| `memoryHeavy` | Use a lazy, reusable 256 KiB high-digit lookup |

Defaults are format checking on, BLAKE3 on, and heavy memory off. Mandatory
integer-length, available-input and trailer bounds stay enabled in every build.
A digest checks decoded bytes, not text spelling or authorship. Keep format
checking enabled for untrusted encoded text.

## Build and encode

Install Rust 1.85+ with its baseline Wasm target, Node.js 20+, and native `gzip`:

```sh
rustup target add wasm32v1-none
npm ci
cargo build --release --locked
cargo run --release --locked -- build --all
```

For byte-reproducible distributions, use Rust 1.99.1, esbuild 0.28.2 and Binaryen
129; CI pins these versions. esbuild and Binaryen are installed by `npm ci`.
Set `ESBUILD_BINARY_PATH` or `WASM_OPT` to use an explicit tool.

The executable is `target/release/glyphpack` (`.exe` on Windows).

```sh
# BLAKE3 integrity and full automatic mask search; payload UTF-16LE without BOM.
glyphpack encode input.bin -o payload.utf16

# Sampled mask ranking followed by exact whole-input shortlist scoring.
glyphpack encode input.bin --effort fast -o payload.utf16

# Return UTF-8 text for a caller managing its own document serialization.
glyphpack encode input.bin --text -o payload.txt

# Complete offline HTML example, using an inline ES module.
glyphpack demo demo.html
```

GlyphPack is a binary-to-text transport, not a compressor. Compress input first
when appropriate. Automatic XOR selection never enlarges the identity-mask body.
Full search checks every mask unless it reaches the theoretical minimum.
The Rust encoder writes the requested representation directly, borrows input
when no trailer is needed, and avoids intermediate UTF-16 buffers.

## Build only the features you need

```sh
# Fixed secure/default module.
glyphpack build -o decoder.mjs

# Minimal module: no optional verification or hashes.
glyphpack build --data none --no-format-checks -o tiny.mjs

# Only these runtime-selectable settings.
glyphpack build --format on off --data fast none -o choices.mjs

# All 12 runtime combinations.
glyphpack build --full -o full.mjs

# Select one or both memory strategies independently.
glyphpack build --memory-heavy off on -o adaptive.mjs
```

One value on an axis fixes its behavior at build time; runtime options cannot
override it. Multiple values add handlers only for the selected choices.
Unselected Rust code and JS option/error handling are removed. `--readable`
produces readable glue; `--module` is accepted for compatibility but all builds
are ES modules. Use an inline `<script type="module">` when embedding one in HTML.

`dist/default.*` is the fixed secure profile. `core.*` and `none.*` are identical
minimal profiles. `fast-none.*`, `high-memory.*`, and `full.*` show other selections.
Sizes, digests and embedded Wasm/gzip sizes are recorded in `dist/profiles.json`.
Missing Wasm or `DecompressionStream` rejects module import with a clear error.

## HTML insertion

The encoder and injector are independent Rust APIs:
`encoder::{encode_text, dense16, EncodeOptions}` and
`injector::{payload_element, inject_html, utf16_document}`.

```sh
glyphpack inject template.html payload.utf16 output.html
```

The UTF-8 template's `__PAYLOAD__` marker receives an inert script data block;
the resulting document is UTF-16LE with a BOM. The template supplies its module
code. Preserve payload `textContent` exactly: do not trim or entity-escape it.
See [format and embedding details](docs/format.md).

## Verify and compare

```sh
npm test                         # Rust vectors + 63 specialized Wasm profiles
npm run test:browser              # Browser matrix, peers and offline HTML
npm run bench                    # Decode-only comparison in Chromium
npm run bench:encode             # Native encoder CSV
npm run summary                  # Small historical sharing CSV
```

`CHROMIUM_BIN` selects the browser and `CHROMIUM_VERSION` its expected exact
version. The historical benchmark baseline remains Chromium 156.0.8078.79;
the compatibility floor is Chrome 109. Historical CSV results describe the former
JS implementation. New Wasm measurements go into `generated/results/`.
The pure-JS implementation is retained only under tests/reference and optimization
archives for differential testing, never as a shipped runtime fallback.

[Benchmark methodology](docs/benchmarking.md) · [Source map](docs/source-map.md)

## Build the demo

```sh
rustup target add wasm32-unknown-unknown
npm run build:site
npm run test:site
# Serve generated/pages/ with any static HTTP server.
```

`site/` contains plain HTML, CSS and browser JS. A module worker runs both
engines. `crates/encoder-wasm/` reuses the native Rust encoder and is built only
for the workbench; it adds no bytes to the decoder distributions. The browser
encoder is lowered to baseline Wasm and packaged with native gzip + base64.

The Pages workflow builds, tests and deploys `generated/pages/` on main pushes.
The demo limits files and inflated output to 16 MiB, and previews large inputs
without rendering the entire file. Use the CLI for larger assets. Local timing
is a warmed decode-only comparison, including the chosen verification.

## Layout

```text
src/encoder.rs           native packing, mask search and output backends
src/hash.rs              native/shared Wasm XXH32 and BLAKE3
src/injector.rs          generic HTML insertion
src/builder.rs           specialized Wasm + gzip/base64 ESM builds
src/transport.rs         native gzip and base64 output
src/decoder/             browser loader, ABI adapter and option selectors
src/tooling/             Rust fixtures, hosting, reports and distributions
crates/decoder-wasm/     allocator-free Wasm parser and hot loops
crates/encoder-wasm/     optional workbench encoder, shared native source
site/                    framework-free Pages workbench
dist/                    standalone ESM distributions
examples/                usage examples and encoder benchmark
tests/                   vectors, regressions and frozen references
benchmarks/              browser comparison, licensed peers and past results
docs/                    wire format and methodology
```

[Contributing](CONTRIBUTING.md) · [Third-party notices](docs/third-party.md)

## Relocatable CLI

`glyphpack encode`, `glyphpack inject` and `glyphpack --version` work from any
directory. They do not require Node, Wasm tools, or a source checkout. Source-only
commands (`build`, `demo`, `site`, `fixtures`, tests and browser benchmarks) find
the checkout in the current directory or its ancestors. Set `GLYPHPACK_ROOT` to
select another checkout explicitly. This also lets a downloaded CLI build the
matching sources without depending on its original build-machine paths.

GitHub CI covers the pinned production toolchain, native ARM64, and the declared
Rust 1.85 minimum. The manual **benchmarks** workflow publishes raw measurements,
CPU/browser details, compact CSVs and a chart as downloadable Actions artifacts.

## Use the Rust codec without build tools

Encoding, hashing and HTML injection need no third-party Rust dependencies:

```toml
[dependencies]
glyphpack = { path = "path/to/glyphpack", default-features = false }
```

```rust
use glyphpack::encoder::{dense16, EncodeOptions};
let packed = dense16(b"hello", &EncodeOptions::default())?;
```

The default `tools` feature adds the CLI, decoder compilation, benchmark/report
utilities and their JSON dependency. Disabling it leaves the codec APIs intact.

Release downloads are explained in [Start here](docs/downloads.md). Native CLI
archives are built and tested as static musl binaries for Linux x86_64/aarch64.
The manual packages workflow produces reviewable archives; it never publishes a
release automatically. [Release checklist](docs/releasing.md).

TypeScript declarations accompany each distribution and expose only its selected
runtime options. Custom builds can write matching declarations separately:

```sh
glyphpack build --full -o decoder.mjs --types decoder.d.mts
```

`npm run test:types` checks accepted/rejected policies, and `npm run test:package`
installs a real local tarball in a clean directory and tests all six exports.
GitHub runs these consumer checks on Node 20 and 22.
