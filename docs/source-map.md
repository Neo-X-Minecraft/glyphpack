# Implementation map

| Area                                   | Source                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Current encoder, masks, pair packing   | src/encoder.rs                                                                   |
| ANS/Windows encoders                   | src/encoder/ans.rs                                                               |
| Compact UTF-8 encoding/guards          | src/utf8_compact.rs, src/utf8-compact/ans.rs                                     |
| Compact adapter/native arithmetic      | src/utf8-compact/ans.mjs, crates/decoder-wasm/src/utf8_compact.rs                |
| Fast UTF-8                             | src/utf8_raw.rs, src/utf8-raw/                                                   |
| Dispatch/integrity bridge              | src/decoder/                                                                     |
| Native arenas/kernels                  | crates/decoder-wasm/src/                                                         |
| XXH32/BLAKE3                           | src/hash.rs, src/hash/simd.rs                                                    |
| Builder/declarations/transport         | src/builder.rs, src/transport.rs                                                 |
| HTML insertion                         | src/injector.rs                                                                  |
| CLI/tooling                            | src/main.rs, src/tooling/                                                        |
| Workbench                              | crates/encoder-wasm/, site/                                                      |
| Current tests/oracles                  | tests/                                                                           |

Dist is generated. No retired payload reader is included.
