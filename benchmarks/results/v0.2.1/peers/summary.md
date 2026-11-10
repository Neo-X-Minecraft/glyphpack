# Decode benchmark

Resident string → fresh bytes, including selected verification. Encoding, I/O, parsing and module initialization are excluded. Values are **milliseconds**, the median of per-browser-run medians. Compact lookup; format checks enabled for GlyphPack. Peer validation and verifier implementations differ.

## No integrity · random 1 MiB

| Decoder | Median ms | Run range ms |
| --- | ---: | ---: |
| Base64 | 0.6000 | 0.6000–0.8000 |
| GlyphPack-Wasm | 2.5000 | 2.5000–2.6000 |
| Base85 | 3.0000 | 2.9000–3.1000 |
| Base64-atob | 4.0000 | 4.0000–4.2000 |
| Base122 | 5.6000 | 5.6000–5.7000 |
| Base121 | 5.8000 | 5.7000–5.8000 |

## XXH32 · random 1 MiB

| Decoder | Median ms | Run range ms |
| --- | ---: | ---: |
| Base64 | 0.8000 | 0.7000–1.0000 |
| GlyphPack-Wasm | 2.7000 | 2.6000–2.8000 |
| Base85 | 3.1000 | 3.1000–3.3000 |
| Base64-atob | 4.2000 | 4.2000–4.4000 |
| Base122 | 5.9000 | 5.8000–5.9000 |
| Base121 | 5.9000 | 5.9000–6.0000 |

## BLAKE3 · random 1 MiB

| Decoder | Median ms | Run range ms |
| --- | ---: | ---: |
| Base64 | 2.9000 | 2.8000–3.0000 |
| GlyphPack-Wasm | 3.6000 | 3.6000–3.8000 |
| Base85 | 5.2000 | 5.2000–5.3000 |
| Base64-atob | 6.4000 | 6.3000–6.6000 |
| Base122 | 7.9000 | 7.8000–7.9000 |
| Base121 | 8.0000 | 7.9000–8.1000 |

All settings and datasets are in `compact.csv`; `summary.csv` includes run ranges and sample counts. Consult the raw CSV and environment JSON before making performance claims. Different machines and browsers can change the ranking.
