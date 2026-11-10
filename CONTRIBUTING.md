# Contributing

Code contributed to GlyphPack is licensed under 0BSD. Retain separate notices
for third-party references. Changes should preserve wire format 3, decoder API,
error messages, fixed/runtime build semantics and mandatory allocation bounds.

```sh
npm ci
cargo fmt --all
cargo clippy --locked --all-targets -- -D warnings
npm test
npm run build
npm run test:browser
```

Edit authoritative sources rather than `dist/` or archived candidates. Rebuild
and include changed distribution files. Keep the const-specialized Wasm pair implementation authoritative. Frozen JS
references are for compatibility comparisons, not runtime fallbacks.

For performance changes, compare complete calls with matching outputs and
verification. Warm up, alternate order, consume results and report repeated
measurements with environment details. Keep correctness work outside timers.
Do not replace the recorded baseline results with numbers from another browser
or different inputs. New local output belongs under `generated/results/`.

Folder names are lowercase. Rust owns native tooling and decoding; JS owns loading, the ABI adapter, and
execution-specific browser/Node tests.

CLI changes must work outside the compile-time source directory. `tests/cli.rs`
checks encoding, injection, version output and source-checkout errors from an
unrelated directory. Build tools discover the checkout at runtime; use
`GLYPHPACK_ROOT` for explicit selection. The native CI jobs check Rust 1.85 and
ARM64 independently of the full Wasm/browser suite.
