# Compact UTF-8: finite-state replacement

The selected `~c2` UTF-8 ANS channel replaces new enumerative `~c1` encodes.
The same raw bytes now decode 192× faster on the recorded
1 MiB fixture, costing 487 extra payload bytes (0.0464
percentage points of input overhead). It retains
97.4%
of the old compact format's size advantage over fast UTF-8. Old packets remain
readable through the legacy BigInt decoder; **re-encode to obtain the speedup**.

## Paired complete-call results

Recorded 2026-11-14T05:39:12.964Z, Chromium **156.0.8078.79**, Linux arm64.
Three fresh browser processes; rotated case order. New paths use seven measured
two-call batches (64 calls for 1 KiB). The old path uses three single-call batches
because it is slow. Both modules are also warmed with identical fast-path
input mixes, avoiding different V8 string feedback. Medians below are medians of process medians; CSV and JSON
retain the process spread and raw batches. Imports, encoding, warm-up and SHA-256
correctness checks are outside timing. Staging, allocation, requested integrity
and the owned output copy are included. Both none-mode comparisons retain format
verification. This compares different representations of identical input bytes,
not identical packet strings. Source sizes exclude decoder and HTML shell.

| 1 MiB random input | Payload bytes | Overhead | Full binary() ms |
| --- | ---: | ---: | ---: |
| Previous compact, ~c1, none | 1,171,980 | 11.7687% | 2054.920 |
| New compact, ~c2, none | 1,172,467 | 11.8152% | 10.700 |
| New compact, XXH32 | 1,172,472 | — | 10.900 |
| New compact, BLAKE3 | 1,172,503 | — | 11.955 |
| Fast UTF-8, none | 1,190,796 | 13.5632% | 4.642 |

| Input | Old compact ms | New compact ms | Old payload bytes | New payload bytes |
| --- | ---: | ---: | ---: | ---: |
| random-1KiB | 0.735 | 0.011 | 1,155 | 1,161 |
| random-64KiB | 128.135 | 0.688 | 73,259 | 73,296 |
| random-1MiB | 2054.920 | 10.700 | 1,171,980 | 1,172,467 |
| zeros-1MiB | 2.510 | 2.940 | 1,118,494 | 1,118,494 |
| ff-1MiB | 2053.570 | 8.755 | 1,171,980 | 1,172,584 |

Masks are fixed to zero for this comparison. Automatic masking can improve
structured inputs. The compact encoder compares its ANS representation with
the existing fast representation and emits the shorter string; for zero-filled
input, both old and new compact paths select that fast alternative. No input
compression is counted. A single host and these distributions do not establish
global rankings or tail latency.

## Why this is faster

The previous decoder reconstructs 32,768-bit ranks by repeatedly multiplying
BigInts by UTF-8 weights, then shifts them a byte at a time. Fixed 4 KiB blocks
bound the memory but leave substantial large-integer arithmetic and allocation.
The replacement uses a 38-bit rANS state, normalized with byte-sized I/O. Its
probabilities approximate the capacity-achieving distribution of 126 one-byte,
1,920 two-byte and 61,406 three-byte UTF-8 scalars. Dropping four-byte scalars
costs only about 0.05 percentage points of asymptotic density.

Experiments covered five normalization ranges, JS Number and uint32 kernels,
a prefix-code alternative, native integer/floating quotients and two input-copy
loops. On the initial random fixture, JS ANS with the selected large state took
about 34 ms and the prefix candidate about 13 ms with 12.32% payload expansion.
Native integer ANS took about 10 ms; specializing the post-normalization quotient
as a constant **32-bit** division reduced the standalone candidate to about
8.7–8.9 ms. The post-normalization state is below F*2^15, hence below 2^31.
That exact bound justifies the narrowing; it does not truncate a large live
state. Floating quotients were slower and were rejected. The complete selected
adapter above also includes parsing, guards, native policy checks and copying.

Only the measured native ANS winner ships for new compact packets. Fast UTF-8
retains its selected JS unpacker. Both paths share the existing Rust/Wasm hashes;
compact ANS hashes its native output directly and avoids an extra verification
copy through JS. New compact warm-up has no large model to initialize. Legacy
BigInt tables are allocated only if an old enumerative packet is actually read.

## Format, verification and size

Public `binary()` and `warmup()` APIs, codec tag U+000E, XOR masking,
BLAKE3/XXH32/none modes, strict defaults, selected builder subsets and all five
packing names remain. The inner new marker is `~c2`, with a length varint and
seven base64 digits for the terminal state. All builds enforce state, capacity,
trailer and decoded-coverage bounds before hashing. Strict mode additionally
checks guarded text and canonical stopping. The unchecked mode may accept a
redundant zero-output terminal symbol; a digest checks bytes, not text spelling.

The full minified module is **24,172 bytes**;
the fixed secure compact module is **14,507 bytes**.
They were 21,794 and 12,312 bytes before this change.
The extra native kernel and adapter are included in those totals. Compact-only
none-mode builds now include the faster Wasm kernel; fast-UTF-8-only none-mode
builds still omit Wasm. Chrome 109 remains the compatibility baseline.

Validation includes all 39 selected builds, 53,613 Node comparisons, 44 independent
JS-oracle comparisons of the new stored bytes, direct allocation/digest bounds,
corruption checks in both integrity modes, all UTF-16 unit classifications,
canonical/unchecked distinctions, legacy reading and owned-output checks.
Each of Chromium 156 and Chrome 109 passed 14,467 comparisons, 4,989 expected
rejections, offline HTML for every codec (including new ~c2), ten large cases,
and hostile parser-transition fixtures. Rust tests, all 63 existing specialized
kernels, TypeScript/package checks and all 60 workbench combinations also pass.

[Compact CSV](summary.csv) · [all final samples and hashes](final.json) ·
[JS/prefix screening](screen.json) · [Wasm screening](wasm.json) ·
[API and wire integration](../../../docs/integration.md).

Reproduce from a configured checkout (no network publishing):

```sh
cargo run --release --locked -- build --all
cargo run --release --locked --example compact_speed
node benchmarks/compact-final.cjs
node benchmarks/compact-report.cjs
```
