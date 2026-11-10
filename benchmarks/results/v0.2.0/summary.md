# Decode benchmark

Resident string → fresh bytes, including selected verification. Encoding, I/O, parsing and module initialization are excluded. Values are **milliseconds**, the median of per-browser-run medians. Compact lookup; format checks enabled for GlyphPack. Peer validation and verifier implementations differ.

## No integrity · random 1 MiB

| Decoder | Median ms | Run range ms |
| --- | ---: | ---: |
| Base64 | 0.7000 | 0.7000–0.7000 |
| GlyphPack-Wasm | 2.7000 | 2.7000–2.9000 |
| Base85 | 3.3000 | 3.2000–3.3000 |
| Base64-atob | 4.4000 | 4.3000–4.5000 |
| Base122 | 6.2000 | 6.2000–6.3000 |
| Base121 | 6.3000 | 6.3000–6.3000 |

## XXH32 · random 1 MiB

| Decoder | Median ms | Run range ms |
| --- | ---: | ---: |
| Base64 | 0.9000 | 0.9000–1.0000 |
| GlyphPack-Wasm | 2.9000 | 2.9000–3.0000 |
| Base85 | 3.5000 | 3.4000–3.5000 |
| Base64-atob | 4.6000 | 4.6000–4.8000 |
| Base121 | 6.5000 | 6.5000–6.6000 |
| Base122 | 6.5000 | 6.4000–6.5000 |

## BLAKE3 · random 1 MiB

| Decoder | Median ms | Run range ms |
| --- | ---: | ---: |
| Base64 | 3.2000 | 3.1000–3.2000 |
| GlyphPack-Wasm | 5.4000 | 5.4000–5.6000 |
| Base85 | 5.7000 | 5.6000–5.8000 |
| Base64-atob | 7.1000 | 6.9000–7.2000 |
| Base122 | 8.6000 | 8.6000–8.8000 |
| Base121 | 8.8000 | 8.7000–8.9000 |

All settings and datasets are in `compact.csv`; `summary.csv` includes run ranges and sample counts. Consult the raw CSV and environment JSON before making performance claims. Different machines and browsers can change the ranking.
