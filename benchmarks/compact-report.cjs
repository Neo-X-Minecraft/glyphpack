/* 0BSD, NeoX. Current compact results, with exact module fingerprint checks. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  dir = path.join(__dirname, "results/compact-speed"),
  { meta, records } = JSON.parse(fs.readFileSync(path.join(dir, "final.json"))),
  p = require("../dist/profiles.json"),
  median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
for (const s of Object.values(meta.sources)) {
  const b = fs.readFileSync(path.join(root, s.file));
  assert.equal(b.length, s.bytes);
  assert.equal(crypto.createHash("sha256").update(b).digest("hex"), s.sha256);
}
const rows = [...new Set(records.map((r) => r.input))].flatMap((input) =>
  ["compact-none", "compact-fast", "compact-secure", "fast-utf8"].map(
    (name) => {
      const a = records.filter((r) => r.input === input && r.name === name);
      return { ...a[0], ms: median(a.map((r) => r.medianMs)) };
    },
  ),
);
fs.writeFileSync(
  path.join(dir, "report.md"),
  `# GlyphPack 1.0.0 compact measurements\n\nCurrent encodings only. Recorded ${meta.recordedAt} on Chromium ${meta.browser},\n${meta.arch}, ${meta.cpu || "CPU not recorded"}; ${meta.runs} fresh processes, rotated order, ${meta.rounds} measured batches.\nImports, encoding, warm-up and SHA-256 checks are outside timing. Allocation,\nformat checks, selected integrity, native staging and owned output copying count.\nResults describe this host and input mix.\n\n| Input | Decoder / integrity | Payload bytes | Median ms |\n| --- | --- | ---: | ---: |\n${rows.map((r) => "| " + r.input + " | " + r.name + " | " + r.sourceBytes + " | " + r.ms.toFixed(3) + " |").join("\n")}\n\nFull module: ${p["full.min.mjs"].bytes} bytes. Secure compact module:\n${p["utf8-compact.min.mjs"].bytes} bytes.\n\n[CSV](summary.csv) · [Raw batches](final.json) ·\n[Historical measurements only](historical-comparison.json). Previous payload\nimplementations are removed and are not benchmarked or loaded.\n`,
);
console.log("Current compact report generated");
