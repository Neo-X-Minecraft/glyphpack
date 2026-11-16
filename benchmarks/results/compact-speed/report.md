# GlyphPack 1.0.0 compact measurements

Current encodings only. Recorded 2026-11-16T15:25:25.604Z on Chromium 156.0.8078.79,
arm64, unknown; 3 fresh processes, rotated order, 7 measured batches.
Imports, encoding, warm-up and SHA-256 checks are outside timing. Allocation,
format checks, selected integrity, native staging and owned output copying count.
Results describe this host and input mix.

| Input | Decoder / integrity | Payload bytes | Median ms |
| --- | --- | ---: | ---: |
| random-1KiB | compact-none | 1161 | 0.011 |
| random-1KiB | compact-fast | 1166 | 0.011 |
| random-1KiB | compact-secure | 1197 | 0.013 |
| random-1KiB | fast-utf8 | 1175 | 0.010 |
| random-64KiB | compact-none | 73296 | 0.680 |
| random-64KiB | compact-fast | 73300 | 0.707 |
| random-64KiB | compact-secure | 73331 | 0.778 |
| random-64KiB | fast-utf8 | 74434 | 0.292 |
| random-1MiB | compact-none | 1172467 | 11.058 |
| random-1MiB | compact-fast | 1172472 | 11.262 |
| random-1MiB | compact-secure | 1172503 | 12.772 |
| random-1MiB | fast-utf8 | 1190796 | 4.765 |
| zeros-1MiB | compact-none | 1118494 | 3.265 |
| zeros-1MiB | compact-fast | 1118498 | 3.623 |
| zeros-1MiB | compact-secure | 1118531 | 5.100 |
| zeros-1MiB | fast-utf8 | 1118494 | 2.552 |
| ff-1MiB | compact-none | 1172584 | 8.483 |
| ff-1MiB | compact-fast | 1172588 | 8.653 |
| ff-1MiB | compact-secure | 1172619 | 10.200 |
| ff-1MiB | fast-utf8 | 1198385 | 4.128 |

Full module: 21390 bytes. Secure compact module:
12448 bytes.

[CSV](summary.csv) · [Raw batches](final.json) ·
[Historical measurements only](historical-comparison.json). Previous payload
implementations are removed and are not benchmarked or loaded.
