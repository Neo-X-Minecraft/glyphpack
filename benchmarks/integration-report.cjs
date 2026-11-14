/* 0BSD, NeoX. Report recorded decode samples without rerunning benchmarks.
 * Refuse stale artifact claims: every file-backed source must match its hash. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  dir = path.join(__dirname, "results/integration"),
  { meta, records } = JSON.parse(
    fs.readFileSync(path.join(dir, "decode.json")),
  ),
  profiles = require("../dist/profiles.json"),
  median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1],
  value = (name) =>
    median(records.filter((r) => r.name === name).map((r) => r.medianMs)),
  f = (n) => n.toLocaleString("en-US"),
  ms = (n) => n.toFixed(3),
  pct = (n) => n.toFixed(3) + "%";
for (const s of meta.sources)
  if (s.file) {
    const bytes = fs.readFileSync(path.join(root, s.file));
    assert.equal(bytes.length, s.bytes, "Stale module length " + s.file);
    assert.equal(
      crypto.createHash("sha256").update(bytes).digest("hex"),
      s.sha256,
      "Stale module hash " + s.file,
    );
  }
const codecs = ["pair", "ans", "windows", "utf8", "utf8-compact"],
  payload = (name) =>
    meta.payloads.find((r) => r.packing === name && r.mode === "none"),
  modules = [
    "default.min.mjs",
    "recommended-full.min.mjs",
    "utf8.min.mjs",
    "utf8-compact.min.mjs",
    "utf8-raw.min.mjs",
    "full.min.mjs",
  ];
const text = `# Local five-codec integration measurements

Recorded ${meta.recordedAt} on ${records[0].browser}, ${meta.architecture}.
Three fresh Chromium processes; ${meta.rounds} rotated measured rounds per
ordinary variant, two calls per batch. New compact ANS uses the same ordinary timing batches. Legacy BigInt packets,
when present, use three single-call rounds; see the paired replacement study. Values below are medians of
the per-process medians. The CSV retains each process's median range; the JSON
retains all samples, artifact hashes, input hash and timing scope. No CPU pinning
or cross-device performance guarantee is implied.

All variants recover the same ${f(meta.inputBytes)} deterministic pseudorandom
bytes, verified by SHA-256 outside timing. Encoding, import, warm-up and digest
comparison of the benchmark output are excluded. Calls include fresh output
allocation, dispatch, JS/Wasm staging, requested integrity and output copying.
None mode still checks format except the explicitly unchecked/core variants.
The tuned Base122 peer is permissive and returns a view over an oversized
buffer; GlyphPack includes strict structural checks and exact output allocation.

## Native-source density and complete full-module calls

Payload sizes include codec framing and mask/length headers, excluding the
module and HTML shell. Source bytes use each codec's intended charset; these
numbers are not the size of a document mixing all five logical strings.
BLAKE3 timing uses separately encoded secure packets, including their trailer.

| Codec | Native payload bytes (none) | Expansion | Full, none (ms) | Full, BLAKE3 (ms) |
| --- | ---: | ---: | ---: | ---: |
${codecs
  .map((n) => {
    const p = payload(n);
    return (
      "| " +
      n +
      " | " +
      f(p.nativeBytes) +
      " | " +
      pct((p.nativeBytes / meta.inputBytes - 1) * 100) +
      " | " +
      ms(value(n + "-none")) +
      " | " +
      ms(value(n + "-secure")) +
      " |"
    );
  })
  .join("\n")}
| Tuned Base122 (UTF-8) | ${f(meta.base122Bytes)} | ${pct((meta.base122Bytes / meta.inputBytes - 1) * 100)} | ${ms(value("base122-tuned"))} | — |

Fast UTF-8 saves ${f(meta.base122Bytes - payload("utf8").nativeBytes)} payload bytes
against Base122 on this input. Compact UTF-8 saves
${f(payload("utf8").nativeBytes - payload("utf8-compact").nativeBytes)} more bytes,
using the new finite-state ANS path. The previous 4 KiB BigInt enumeration
was much slower; [the paired replacement study](../compact-speed/report.md)
compares both representations of the same input. These are binary-to-text transports;
compress redundant input separately when useful.

## Fast UTF-8 integration cost

| Call | Median ms |
| --- | ---: |
${["previous-raw", "current-raw", "utf8-core", "utf8-strict-js", "utf8-secure-fixed", "utf8-none", "utf8-secure", "utf8-unchecked", "base122-tuned"].map((n) => "| " + n + " | " + ms(value(n)) + " |").join("\n")}

The original 2,319-byte selected decoder is frozen under experiments, rather
than reconstructed from later sources. Current raw and fixed strict adapters
remain competitive with it and tuned Base122. The integrated decoder reads the
original framed string directly instead of slicing its large body. Multi-policy
builds accumulate the cheap validity sign without branching for every symbol,
then apply the requested policy once at the end. Fixed unchecked builds erase
that accumulator. No data-dependent backend or runtime benchmarking is shipped.
The selected fast unpacker is JavaScript; the earlier Wasm/hybrid search did not
beat it. Integrity verification shares the existing Rust/Wasm implementation.

## Current complete module sizes

| Module | Bytes |
| --- | ---: |
${modules.map((n) => "| " + n + " | " + f(profiles[n].bytes) + " |").join("\n")}

The full ESM embeds ${f(profiles["full.min.mjs"].wasmBytes)} Wasm bytes compressed
to ${f(profiles["full.min.mjs"].gzip9Bytes)} gzip bytes and
${f(profiles["full.min.mjs"].base64Bytes)} base64 characters. These are already
included in its ${f(profiles["full.min.mjs"].bytes)}-byte module size.
It supports all five transports, three integrity policies, both format policies,
and both pair lookup policies. Defaults remain strict BLAKE3, memory false.
Compact BLAKE3 scalar code is a separate build flag, not the compact UTF-8 codec.

## Validation

All 31 nonempty codec subsets plus eight extra specialized builds passed
53,613 Node comparisons and 441 expected rejections. Each of Chrome
109.0.5414.119 and Chromium 156.0.8078.79 passed 14,467 comparisons, 4,989
expected rejections, ten 1 MiB cases and six actual offline HTML documents.
Three additional hostile HTML cases per browser verify closing textarea/script,
legacy script comments, mixed case and natural guard runs. No offline network
requests occurred. The separate raw compatibility campaign also passed both
browser versions, all 65,536 UTF-16 unit substitutions, controlled mutations and
normalization checks. Existing pair/ANS/Windows, BLAKE3 reference, package,
TypeScript and 60-case workbench tests pass separately.

- [Compact CSV](summary.csv), [all timing samples](decode.json).
- [Integration compatibility](compatibility.json), [raw compatibility](raw-compatibility.json).
- [Exact API, framing and builder integration](../../../docs/integration.md).

Reproduce from a configured checkout:

\`\`\`sh
cargo run --release --locked -- build --all
cargo run --release --locked --example integration
node tests/integration.cjs
node tests/integration-browser.cjs
node tests/integration-html.cjs
node benchmarks/integration.cjs
node benchmarks/integration-report.cjs
\`\`\`
`;
fs.writeFileSync(path.join(dir, "report.md"), text);
console.log(
  JSON.stringify({
    report: path.relative(root, path.join(dir, "report.md")),
    fullBytes: profiles["full.min.mjs"].bytes,
    processes: meta.runs,
    cases: records.length,
  }),
);
