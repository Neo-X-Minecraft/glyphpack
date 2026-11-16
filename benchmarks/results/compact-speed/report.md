# GlyphPack 1.0.0 compact measurements

Current encodings only. Recorded 2026-11-16T13:13:37.124Z on Chromium 156.0.8078.79,
arm64, unknown; 3 fresh processes, rotated order, 7 measured batches.
Imports, encoding, warm-up and SHA-256 checks are outside timing. Allocation,
format checks, selected integrity, native staging and owned output copying count.
Results describe this host and input mix.

| Input | Decoder / integrity | Payload bytes | Median ms |
| --- | --- | ---: | ---: |
| random-1KiB | compact-none | 1161 | 0.010 |
| random-1KiB | compact-fast | 1166 | 0.010 |
| random-1KiB | compact-secure | 1197 | 0.012 |
| random-1KiB | fast-utf8 | 1175 | 0.010 |
| random-64KiB | compact-none | 73296 | 0.590 |
| random-64KiB | compact-fast | 73300 | 0.585 |
| random-64KiB | compact-secure | 73331 | 0.635 |
| random-64KiB | fast-utf8 | 74434 | 0.270 |
| random-1MiB | compact-none | 1172467 | 9.930 |
| random-1MiB | compact-fast | 1172472 | 10.067 |
| random-1MiB | compact-secure | 1172503 | 11.025 |
| random-1MiB | fast-utf8 | 1190796 | 4.408 |
| zeros-1MiB | compact-none | 1118494 | 2.905 |
| zeros-1MiB | compact-fast | 1118498 | 3.235 |
| zeros-1MiB | compact-secure | 1118531 | 4.185 |
| zeros-1MiB | fast-utf8 | 1118494 | 2.285 |
| ff-1MiB | compact-none | 1172584 | 8.205 |
| ff-1MiB | compact-fast | 1172588 | 8.415 |
| ff-1MiB | compact-secure | 1172619 | 9.277 |
| ff-1MiB | fast-utf8 | 1198385 | 3.722 |

Full module: 22038 bytes. Secure compact module:
12672 bytes.

[CSV](summary.csv) · [Raw batches](final.json) ·
[Historical measurements only](historical-comparison.json). Previous payload
implementations are removed and are not benchmarked or loaded.
