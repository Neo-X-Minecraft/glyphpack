# GlyphPack 1.0.0 refinement

Chromium 156.0.8078.79; ARM64. Current payload format and public browser API are unchanged.
The raw full Wasm SHA-256 is unchanged too: the native decoder and hash kernels
are identical. Module savings come from native Zopfli gzip optimization.

| Module | Before bytes | After bytes | Saved |
| --- | ---: | ---: | ---: |
| full.min.mjs | 22038 | 21390 | 2.94% |
| default.min.mjs | 9471 | 9203 | 2.83% |
| recommended-full.min.mjs | 10614 | 10298 | 2.98% |
| utf8-compact.min.mjs | 12672 | 12448 | 1.77% |
| none.min.mjs | 3914 | 3858 | 1.43% |

Matched complete `binary()` calls: three fresh browser processes, seven batches,
alternating source order. All 60 combinations (five codecs, three integrity
modes, two format policies, two memory flags) pass independent SHA-256 checks.
Warm resident strings, allocation, requested checks, staging and owned copying
count; encoding, imports, warm-up and SHA-256 do not. Memory flags affect only
pair; both flag values are retained for every codec to cover the full API matrix.

| 1 MiB, strict + BLAKE3, memory false | Before ms | After ms |
| --- | ---: | ---: |
| pair | 4.205 | 4.210 |
| ans | 4.035 | 4.040 |
| windows | 5.560 | 5.560 |
| utf8 | 5.528 | 5.505 |
| utf8-compact | 12.317 | 12.275 |

Ordinary bulk throughput is effectively unchanged. Early narrower screens showed
larger gains that did not persist across the full policy matrix. Small-call
results vary more with JIT/GC; their isolated measurements are included, rather
than presented as guaranteed speedups. Initial mixed-size micro measurements were
discarded because bulk allocations biased the next tiny batch.

The new guard validator uses a native fast scan for ordinary packets and avoids
per-match callbacks for guarded text. In the separate guard-only stress test:

| Guard input | Before ms | After ms |
| --- | ---: | ---: |
| guarded-script | 12.95 | 6.25 |
| guarded-run | 20.75 | 14.75 |

Those guard-only gains do not describe complete decode latency. The validator
passed 23,375 differential cases, including malformed UTF-16 and both policies.

Compression remains standard gzip, decoded by native DecompressionStream.
Zopfli runs only during native builds. For the 31,045-byte full kernel, gzip -9
produced 11,099 bytes; Zopfli at 15/100/1000 iterations produced
10,604/10,603/10,593 bytes. 1000 iterations cost about 6.4 times 100 for ten more
bytes saved, so builds use 100. Repeated small-asset compression is cached with
a bounded one-entry cache; tool version probes are reused per file/environment.

Shared staging, masked UTF-8 lookups, narrow-symbol unrolling and interleaved
compact states were tested and rejected for size/speed regressions on the input
mix. No alternate payload format or speculative decoder backend was retained.

CSV case names use `packing:integrity:format:memory` with 1=true and 0=false.
Negative change percentages mean faster. Small-N rows use strict BLAKE3 and
memory false.

[All policy CSV](summary.csv) · [Raw batches and exact module hashes](decode.json) ·
[Guard observations](guards.json) · [Compression effort](compression.csv).

Reproduce after building current integration fixtures:

```sh
node benchmarks/refinement.cjs before.mjs after.mjs
```

Use CHROMIUM_BIN for the recorded browser. REFINE_SIZES and REFINE_OUTPUT can
select input sizes or a separate output folder. Baseline module: commit 716f593,
current 1.0.0 format. No predecessor-format implementation is required.
