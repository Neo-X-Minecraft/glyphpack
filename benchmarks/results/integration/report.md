# GlyphPack 1.0.0 current-format measurements

Recorded 2026-11-16T13:13:14.464Z, Chromium 156.0.8078.79, arm64, unknown.
3 fresh processes; 9 rotated two-call batches per case. Strings are
resident, modules and caches warmed. Allocations, dispatch, staging, selected
integrity and owned copying count. Encoding/imports/SHA-256 checks do not.

| Codec | Native source bytes | None ms | BLAKE3 ms |
| --- | ---: | ---: | ---: |
| pair | 1052854 | 2.250 | 3.375 |
| ans | 1051766 | 2.038 | 3.198 |
| windows | 1050083 | 3.270 | 4.425 |
| utf8 | 1190792 | 3.238 | 4.407 |
| utf8-compact | 1172468 | 9.515 | 10.585 |

Tuned Base122: 3.370 ms. Its permissive decoder
returns a view over an oversized buffer; GlyphPack retains selected checks and
owned exact output. Source sizes use each codec’s intended document charset.
Full module: 22038 bytes. Results are host-specific.

[CSV](summary.csv) · [Raw samples and hashes](decode.json).
