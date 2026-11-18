# GlyphPack 1.0.0 current-format measurements

Recorded 2026-11-16T15:24:54.534Z, Chromium 156.0.8078.79, arm64, unknown.
3 fresh processes; 9 rotated two-call batches per case. Strings are
resident, modules and caches warmed. Allocations, dispatch, staging, selected
integrity and owned copying count. Encoding/imports/SHA-256 checks do not.

| Codec | Native source bytes | None ms | BLAKE3 ms |
| --- | ---: | ---: | ---: |
| pair | 1052854 | 2.443 | 4.175 |
| ans | 1051766 | 2.245 | 4.005 |
| windows | 1050083 | 3.760 | 5.512 |
| utf8 | 1190792 | 3.710 | 5.507 |
| utf8-compact | 1172468 | 10.657 | 12.352 |

Tuned Base122: 3.843 ms. Its permissive decoder
returns a view over an oversized buffer; GlyphPack retains selected checks and
owned exact output. Source sizes use each codec’s intended document charset.
Full module: 21390 bytes. Results are host-specific.

[CSV](summary.csv) · [Raw samples and hashes](decode.json).
