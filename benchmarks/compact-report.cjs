/* 0BSD, NeoX. Render paired raw measurements; reject stale decoder claims. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  dir = path.join(__dirname, "results/compact-speed"),
  { meta, records } = JSON.parse(fs.readFileSync(path.join(dir, "final.json"))),
  profiles = require("../dist/profiles.json"),
  median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1],
  f = (n) => n.toLocaleString("en-US"),
  ms = (n) => n.toFixed(3),
  row = (input, name) => {
    const a = records.filter((r) => r.input === input && r.name === name);
    return {
      ...a[0],
      ms: median(a.map((r) => r.medianMs)),
      lo: Math.min(...a.map((r) => r.medianMs)),
      hi: Math.max(...a.map((r) => r.medianMs)),
    };
  };
for (const s of Object.values(meta.sources)) {
  const b = fs.readFileSync(path.join(root, s.file));
  assert.equal(b.length, s.bytes);
  assert.equal(
    crypto.createHash("sha256").update(b).digest("hex"),
    s.sha256,
    "Stale " + s.file,
  );
}
const old = row("random-1MiB", "before"),
  now = row("random-1MiB", "after-none"),
  secure = row("random-1MiB", "after-secure"),
  fast = row("random-1MiB", "fast-utf8"),
  delta = now.sourceBytes - old.sourceBytes,
  inputs = [...new Set(records.map((r) => r.input))];
const report = `# Compact UTF-8: finite-state replacement

The selected \`~c2\` UTF-8 ANS channel replaces new enumerative \`~c1\` encodes.
The same raw bytes now decode ${Math.round(old.ms / now.ms)}× faster on the recorded
1 MiB fixture, costing ${f(delta)} extra payload bytes (${((100 * delta) / now.size).toFixed(4)}
percentage points of input overhead). It retains
${((100 * (fast.sourceBytes - now.sourceBytes)) / (fast.sourceBytes - old.sourceBytes)).toFixed(1)}%
of the old compact format's size advantage over fast UTF-8. Old packets remain
readable through the legacy BigInt decoder; **re-encode to obtain the speedup**.

## Paired complete-call results

Recorded ${meta.recordedAt}, Chromium **${meta.browser}**, Linux ${meta.arch}.
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
| Previous compact, ~c1, none | ${f(old.sourceBytes)} | ${(100 * (old.sourceBytes / old.size - 1)).toFixed(4)}% | ${ms(old.ms)} |
| New compact, ~c2, none | ${f(now.sourceBytes)} | ${(100 * (now.sourceBytes / now.size - 1)).toFixed(4)}% | ${ms(now.ms)} |
| New compact, XXH32 | ${f(row("random-1MiB", "after-fast").sourceBytes)} | — | ${ms(row("random-1MiB", "after-fast").ms)} |
| New compact, BLAKE3 | ${f(secure.sourceBytes)} | — | ${ms(secure.ms)} |
| Fast UTF-8, none | ${f(fast.sourceBytes)} | ${(100 * (fast.sourceBytes / fast.size - 1)).toFixed(4)}% | ${ms(fast.ms)} |

| Input | Old compact ms | New compact ms | Old payload bytes | New payload bytes |
| --- | ---: | ---: | ---: | ---: |
${inputs
  .map((n) => {
    const a = row(n, "before"),
      b = row(n, "after-none");
    return (
      "| " +
      n +
      " | " +
      ms(a.ms) +
      " | " +
      ms(b.ms) +
      " | " +
      f(a.sourceBytes) +
      " | " +
      f(b.sourceBytes) +
      " |"
    );
  })
  .join("\n")}

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

Public \`binary()\` and \`warmup()\` APIs, codec tag U+000E, XOR masking,
BLAKE3/XXH32/none modes, strict defaults, selected builder subsets and all five
packing names remain. The inner new marker is \`~c2\`, with a length varint and
seven base64 digits for the terminal state. All builds enforce state, capacity,
trailer and decoded-coverage bounds before hashing. Strict mode additionally
checks guarded text and canonical stopping. The unchecked mode may accept a
redundant zero-output terminal symbol; a digest checks bytes, not text spelling.

The full minified module is **${f(profiles["full.min.mjs"].bytes)} bytes**;
the fixed secure compact module is **${f(profiles["utf8-compact.min.mjs"].bytes)} bytes**.
They were ${f(meta.sources.before.bytes)} and 12,312 bytes before this change.
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

\`\`\`sh
cargo run --release --locked -- build --all
cargo run --release --locked --example compact_speed
node benchmarks/compact-final.cjs
node benchmarks/compact-report.cjs
\`\`\`
`;
fs.writeFileSync(path.join(dir, "report.md"), report);
console.log(
  JSON.stringify({
    speedup: old.ms / now.ms,
    extraBytes: delta,
    fullBytes: profiles["full.min.mjs"].bytes,
  }),
);
