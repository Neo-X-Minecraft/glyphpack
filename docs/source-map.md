# Implementation map

| Area | Authoritative source |
| --- | --- |
| Alphabet, mask scoring and encoding | `src/encoder.rs` |
| Native and Wasm checksum/digest | `src/hash.rs` |
| HTML insertion | `src/injector.rs` |
| Specialization, optimization and ESM builds | `src/builder.rs` |
| Native gzip level 9 and base64 | `src/transport.rs` |
| One-time browser decompression and instantiation | `src/decoder/loader.js` |
| UTF-16 input copy, output ownership and errors | `src/decoder/wasm-runtime.js` |
| Selected option parsing | `src/decoder/options.js`, `memory-options.js` |
| Wasm header, arenas, tables and integrity dispatch | `crates/decoder-wasm/src/lib.rs` |
| Const-specialized bulk/tail pair loops | `crates/decoder-wasm/src/unpack.rs` |
| CLI | `src/main.rs` |
| Build profiles, test vectors, hosting and reports | `src/tooling/` |
| Demo encoder ABI, reusing the native encoder | `crates/encoder-wasm/src/lib.rs` |
| Static Pages build and encoded fixtures | `src/tooling/site.rs` |
| Workbench UI and background worker | `site/` |

The Wasm crate uses `no_std`, fixed hash scratch and reusable arenas. It imports
no host functions and uses neither a general-purpose allocator nor exception
formatting. Optional high-digit storage is committed only after header guards.
Old arena regions are bounded by geometric growth and reused capacities.

The `wasm32v1-none` target and Binaryen MVP validation with mutable globals keep
the instruction set independent of future Rust target-feature defaults.
The ESM adapter targets Chrome 109. On that browser base64 initialization uses
`atob`; newer engines may use `Uint8Array.fromBase64` when present.

`dist/` is generated output, not a separate implementation. Wasm is specialized
for the selected format/data/memory policies before gzip compression. A module
loads that embedded member once, then calls the same instance synchronously.

Frozen JS sources in `tests/reference/` and optimization archives support exact
byte/error comparisons. They are excluded from production bundles. The old
reference BLAKE3 final shuffle remains intentionally documented where it was
measured; the active Rust hash omits that unused operation.

Native Rust users can disable the default `tools` feature. Encoding, hashes,
injection and transport then compile without third-party Rust dependencies;
the CLI and source/build/report modules are omitted. CI tests both feature sets.
