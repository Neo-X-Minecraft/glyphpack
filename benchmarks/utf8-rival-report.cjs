/* 0BSD, NeoX. Preserve independent process medians, not just pooled batches. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  dir = path.join(__dirname, "results/utf8-rival"),
  raw = JSON.parse(fs.readFileSync(path.join(dir, "final.json"))),
  compat = JSON.parse(fs.readFileSync(path.join(dir, "compatibility.json"))),
  median = (a) => [...a].sort((a, b) => a - b)[a.length >> 1],
  format = (n) => n.toFixed(3),
  csv = (header, rows) =>
    [header, ...rows]
      .map((row) =>
        row
          .map((x) => String(x).replaceAll('"', '""'))
          .map((x) => (/[",\n]/.test(x) ? '"' + x + '"' : x))
          .join(","),
      )
      .join("\n") + "\n",
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const delivered = raw.environment.candidates.find((s) => s.name === "utf8-raw");
assert.equal(
  delivered.sha256,
  sha(fs.readFileSync(path.join(root, "dist/utf8-raw.min.mjs"))),
);
assert.equal(delivered.sha256, compat.module.sha256);
const rows = [];
for (const browser of [...new Set(raw.records.map((r) => r.browser))])
  for (const source of raw.environment.candidates)
    for (const input of raw.environment.inputs) {
      const samples = raw.records.filter(
          (r) =>
            r.browser === browser &&
            r.variant === source.name &&
            r.label === input.label,
        ),
        medians = samples.map((r) => r.medianMs);
      assert.equal(samples.length, raw.environment.runs);
      rows.push({
        browser,
        variant: source.name,
        dataset: input.label,
        inputBytes: input.bytes,
        payloadBytes:
          source.family === "utf8" ? input.payloadBytes : input.base122Bytes,
        moduleBytes: source.moduleBytes,
        median: median(medians),
        min: Math.min(...medians),
        max: Math.max(...medians),
        runs: samples.length,
        batches: samples.reduce((s, r) => s + r.samples.length, 0),
      });
    }
fs.writeFileSync(
  path.join(dir, "decode.csv"),
  csv(
    [
      "browser",
      "decoder",
      "dataset",
      "input_bytes",
      "utf8_payload_bytes",
      "esm_bytes",
      "median_ms",
      "process_min_ms",
      "process_max_ms",
      "processes",
      "batches",
    ],
    rows.map((r) => [
      r.browser,
      r.variant,
      r.dataset,
      r.inputBytes,
      r.payloadBytes,
      r.moduleBytes,
      format(r.median),
      format(r.min),
      format(r.max),
      r.runs,
      r.batches,
    ]),
  ),
);
const short = rows.filter(
  (r) =>
    r.dataset === "random-1MiB" &&
    ["utf8-raw", "base122-groupUnroll", "base122-reference"].includes(
      r.variant,
    ),
);
fs.writeFileSync(
  path.join(dir, "summary.csv"),
  csv(
    [
      "browser",
      "decoder",
      "utf8_payload_bytes",
      "esm_bytes",
      "median_ms",
      "process_min_ms",
      "process_max_ms",
    ],
    short.map((r) => [
      r.browser,
      r.variant,
      r.payloadBytes,
      r.moduleBytes,
      format(r.median),
      format(r.min),
      format(r.max),
    ]),
  ),
);
const compact = [];
for (const browser of [...new Set(rows.map((r) => r.browser))])
  for (const input of raw.environment.inputs) {
    const own = rows.find(
        (r) =>
          r.browser === browser &&
          r.dataset === input.label &&
          r.variant === "utf8-raw",
      ),
      peers = rows.filter(
        (r) =>
          r.browser === browser &&
          r.dataset === input.label &&
          r.variant.startsWith("base122-"),
      ),
      best = peers.reduce((a, b) => (a.median < b.median ? a : b));
    compact.push(
      `| ${browser.split(".")[0]} | ${input.label} | ${format(own.median)} | ${format(best.median)} | ${best.variant.replace("base122-", "")} | ${((own.median / best.median - 1) * 100).toFixed(1)}% |`,
    );
  }
const html = compat.pages.filter((p) =>
  ["native-zero", "base122-reference", "base122-groupUnroll"].includes(p.name),
);
const report =
  `# UTF-8 versus Base122\n\nRecorded ${raw.environment.recordedAt}; ${raw.environment.arch}, ${raw.environment.cpu}.\n\n` +
  `The selected UTF-8 decoder is **${delivered.moduleBytes.toLocaleString("en-US")} bytes**, with a 4 KiB lazy table. It returns validated, owned, exactly sized output. The Base122 competitors keep their unchecked/view-returning policies. Neither side computes a digest.\n\n` +
  `## Complete standalone file size\n\nIdentical 1 MiB synthetic random bytes; actual UTF-8 files with BOM, metadata, decoder, container escaping and payload:\n\n` +
  `| Implementation | Complete HTML bytes |\n| --- | ---: |\n` +
  html
    .map((p) => `| ${p.name} | ${p.htmlBytes.toLocaleString("en-US")} |`)
    .join("\n") +
  "\n\n" +
  `Payload alone: ${compat.input.payloadBytes.toLocaleString("en-US")} bytes for UTF-8 raw and ${compat.input.base122Bytes.toLocaleString("en-US")} for Base122. Expected asymptotic uniform-random overhead is 13.5593% versus 14.2857%. These are measured file sizes, not compressed download sizes or string code units. Small payloads may favor Base122 because its smallest decoder is smaller.\n\n` +
  `## Complete warm decode\n\nMilliseconds per full call: allocation, header, body, XOR and mandatory structural checks are included. Import/HTML parse/encoding/output verification are outside the timer. Each entry is the median of ${raw.environment.runs} independent process medians, each based on ${raw.environment.rounds} rotated batches. The table selects the fastest tested Base122 candidate separately per input/browser; this favors the competitor and is not one adaptive Base122 implementation. Positive difference means UTF-8 raw took longer.\n\n` +
  `| Chrome | Input | UTF-8 raw ms | Fastest Base122 ms | Base122 loop | Time difference |\n| --- | --- | ---: | ---: | --- | ---: |\n` +
  compact.join("\n") +
  "\n\n" +
  `The group-unrolled Base122 candidate applies this format's main constant-shift insight to Base122 too. Comparing only with the slower historical baseline would overstate the gain. The result is a size advantage at competitive decode speed, not a universal speed record. Zero/sequential/ASCII fixtures can favor different loops; the same UTF-8 implementation is used throughout.\n\n` +
  `## Correctness and limits\n\nBoth Chrome versions pass ${compat.browsers[0].valid.toLocaleString("en-US")} valid native vectors (including all 256 masks), ${compat.browsers[0].rejected.toLocaleString("en-US")} rejection cases and ${compat.browsers[0].normalizationPairs.toLocaleString("en-US")} ordered NFC alphabet pairs. Eight offline file pages include hostile script sequences and 10 MiB native HTML; Wasm, decompression streams and fetch are disabled. A UTF-8 BOM also survives deliberately incorrect HTTP charset metadata. This is structural validation, not data integrity or authentication.\n\n` +
  `This is one unpinned Linux aarch64 host, not a cross-device guarantee. Raw samples, process ranges, versions, module hashes, input hashes and timing policy are preserved. Malformed inputs run in separate processes from timing.\n\n` +
  `- [Six-row summary CSV](summary.csv): random 1 MiB, selected decoder and two Base122 baselines.\n- [All aggregated decode comparisons](decode.csv): every selected candidate, dataset and browser, with process ranges.\n- [Every measured batch](final.json).\n- [Offline compatibility and exact file sizes](compatibility.json).\n- [Protocol, limitations and reproduction](../../../docs/utf8-raw.md).\n\n` +
  `Earlier screen/groups/stores/split/bounded JSON files preserve the candidate search; they are separate campaigns and must not be pooled with the final timing.\n`;
fs.writeFileSync(path.join(dir, "report.md"), report);
console.log(report);
