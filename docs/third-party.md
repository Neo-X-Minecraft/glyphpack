# Third-party references

GlyphPack's own code is copyright 2026 **NeoX**, licensed **0BSD**. That license
does not replace licenses on the following independent reference implementations.
They are used only by tests and benchmarks, not by the production JS decoder.

| Reference | License | Local notice |
| --- | --- | --- |
| kevinAlbs/Base122 | MIT | `benchmarks/vendor/encoding-bench/kevinAlbs-Base122-LICENSE.txt` |
| code4fukui/Base122 | MIT | `benchmarks/vendor/encoding-bench/code4fukui-Base122-LICENSE.txt` |
| Sheep-y/Base85 | Apache-2.0 | `benchmarks/vendor/encoding-bench/Sheep-y-Base85-LICENSE` |
| AlttiRi/base85 | MIT | `benchmarks/vendor/encoding-bench/AlttiRi-base85-license` |
| Noble hashes 2.4.0 BLAKE3 reference bundle | MIT | `tests/vendor/hashes/noble-LICENSE` |
| hash-wasm 4.13.0 BLAKE3 reference bundle | MIT and its embedded implementation notices | `tests/vendor/hashes/hash-wasm-LICENSE` |
| Official BLAKE3 vectors | CC0 option | `tests/vendor/hashes/blake3-CC0` |

BLAKE3 vectors originate from
[BLAKE3-team/BLAKE3](https://github.com/BLAKE3-team/BLAKE3/tree/master/test_vectors).
The exact vectors and reference bundles used for the tests are checked in.
The Base122/Base85 manifest records exact upstream commits and file hashes.
Original vendored source and license files are kept intact.

The extracted browser-only Base122 reference returns decoded bytes instead of
publishing a DOM/Blob URL. That adaptation is generated during benchmark
preparation; the upstream file remains unchanged. Local competitor adaptations
are explicitly labeled in browser results.

Rust dependencies are recorded in `Cargo.lock`. Build/test dependencies are
recorded in `package-lock.json`; they are not production decoder dependencies.
