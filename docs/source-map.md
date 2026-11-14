# Implementation map

| Area                                                                      | Authoritative source                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Alphabet, mask scoring and encoding                                       | `src/encoder.rs`                                                                                 |
| Raw UTF-8 encoding, masks and script-literal escaping                     | `src/utf8_raw.rs`                                                                                |
| Raw UTF-8 header, table, padding and constant-shift decoding              | `src/utf8-raw/model.mjs`, `unpack.mjs`, `decoder.mjs`                                            |
| Compact UTF-8 legacy enumerative encoder and script guards                | `src/utf8_compact.rs`                                                                            |
| Legacy ~c1 BigInt decoder and lazy model                                  | `src/utf8-compact/decoder.mjs`                                                                   |
| Compact finite-state ANS encoding and native decoding                     | `src/utf8-compact/ans.rs`, `crates/decoder-wasm/src/utf8_compact.rs`, `src/utf8-compact/ans.mjs` |
| Tagged UTF-8 adapters and shared Wasm integrity bridge                    | `src/decoder/utf8.js`, `utf8-compact.js`, `stored.js`                                            |
| Five-codec subset, verification and offline tests                         | `examples/integration.rs`, `tests/integration*.cjs`                                              |
| Frozen NFC-stable UTF-8 alphabet                                          | `src/utf8-raw/alphabet.rs`                                                                       |
| Raw UTF-8 standalone HTML CLI                                             | `examples/utf8_raw.rs`                                                                           |
| Payload indicators, Unicode ranges and Windows character mapping          | `src/packing.rs`                                                                                 |
| Four-state ANS/Windows encoders                                           | `src/encoder/ans.rs`                                                                             |
| Optional scoped native mask search                                        | `src/encoder/parallel.rs`                                                                        |
| Native browser string conversion                                          | `site/encoder-host.mjs`                                                                          |
| Native and Wasm checksum/digest, including optional compact scalar rounds | `src/hash.rs`                                                                                    |
| Four-chunk BLAKE3 SIMD compression                                        | `src/hash/simd.rs`                                                                               |
| HTML insertion                                                            | `src/injector.rs`                                                                                |
| Specialization, optimization and ESM builds                               | `src/builder.rs`                                                                                 |
| Native gzip level 9 and base64                                            | `src/transport.rs`                                                                               |
| One-time browser decompression and instantiation                          | `src/decoder/loader.js`                                                                          |
| UTF-16 input copy, output ownership and errors                            | `src/decoder/wasm-runtime.js`                                                                    |
| Selected option parsing                                                   | `src/decoder/options.js`, `memory-options.js`                                                    |
| Wasm header, arenas, tables, warm-up and integrity dispatch               | `crates/decoder-wasm/src/lib.rs`                                                                 |
| Const-specialized bulk/tail pair loops                                    | `crates/decoder-wasm/src/unpack.rs`                                                              |
| UTF-16 ANS and Windows decode loops                                       | `crates/decoder-wasm/src/ans.rs`, `windows.rs`                                                   |
| CLI                                                                       | `src/main.rs`                                                                                    |
| Build profiles, test vectors, hosting and reports                         | `src/tooling/`                                                                                   |
| All codec subsets, native fixtures and offline browser QA                 | `src/tooling/codecs.rs`, `tests/codecs.cjs`                                                      |
| Archived input preparation and expansion audit                            | `src/tooling/history.rs`                                                                         |
| Historical CSV aggregation and charts                                     | `src/tooling/history_report.rs`                                                                  |
| Browser candidate, profile and hash measurements                          | `benchmarks/history.cjs`                                                                         |
| Demo encoder ABI, reusing the native encoder                              | `crates/encoder-wasm/src/lib.rs`                                                                 |
| Static Pages build and encoded fixtures                                   | `src/tooling/site.rs`                                                                            |
| Workbench UI and background worker                                        | `site/`                                                                                          |

The Wasm crate uses `no_std`, fixed hash scratch and reusable arenas. It imports
no host functions and uses neither a general-purpose allocator nor exception
formatting. Optional high-digit storage is committed only after header guards.
Old arena regions are bounded by geometric growth and reused capacities.

The `wasm32v1-none` target and explicit SIMD128/mutable-global validation keep
the instruction set independent of future Rust target-feature defaults. SIMD
hashing processes four complete chunks together; tails and tree parents retain
the scalar compression path. No relaxed SIMD, shared memory or threads are used.
An explicit `RUSTFLAGS="-C target-feature=-simd128"` preserves the MVP path.
The ESM adapter targets Chrome 109. On that browser base64 initialization uses
`atob`; newer engines may use `Uint8Array.fromBase64` when present.

`dist/` is generated output, not a separate implementation. Wasm is specialized
for the selected format/data/memory policies before gzip compression. A module
loads that embedded member once, then calls the same instance synchronously.
`--compact-hash` changes only the generated scalar BLAKE3 rounds; the normal
expanded rounds and compact rounds produce identical digests. Pair-only builds
use Binaryen O3, while broader codec builds use O4. The measurements and exact
artifact hashes are documented in `docs/decoder-optimization.md`.

Frozen JS sources in `tests/reference/` and optimization archives support exact
byte/error comparisons. They are excluded from production bundles. The old
reference BLAKE3 final shuffle remains intentionally documented where it was
measured; the active Rust hash omits that unused operation.

Native Rust users can disable the default `tools` feature. Encoding, hashes,
injection and transport then compile without third-party Rust dependencies;
the CLI and source/build/report modules are omitted. CI tests both feature sets.

The separate `utf8-raw` package entry uses JavaScript only, a 4 KiB table and
mandatory structural checks, without a digest. It embeds bytes in ordinary UTF-8
HTML. Its same fast body is now shared with the integrity-checked `utf8`
adapter. The full module also includes the compact finite-state UTF-8 ANS codec, while retaining the legacy reader;
see `docs/integration.md` for exact dispatch and verifier reuse. Its comparison
drivers and candidate loops live under `benchmarks/utf8-rival*` and
`benchmarks/experiments/utf8-rival/`; delivered code lives under `src/`.
