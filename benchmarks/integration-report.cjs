/* 0BSD, NeoX. Current complete decoder calls and source density. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  dir = path.join(__dirname, "results/integration"),
  { meta, records } = JSON.parse(
    fs.readFileSync(path.join(dir, "decode.json")),
  ),
  p = require("../dist/profiles.json"),
  median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1],
  value = (n) =>
    median(records.filter((r) => r.name === n).map((r) => r.medianMs));
for (const s of meta.sources)
  if (s.file) {
    const b = fs.readFileSync(path.join(root, s.file));
    assert.equal(b.length, s.bytes);
    assert.equal(crypto.createHash("sha256").update(b).digest("hex"), s.sha256);
  }
fs.writeFileSync(
  path.join(dir, "report.md"),
  `# GlyphPack 1.0.0 current-format measurements\n\nRecorded ${meta.recordedAt}, Chromium ${records[0].browser}, ${meta.architecture}, ${meta.cpu || "CPU not recorded"}.\n${meta.runs} fresh processes; ${meta.rounds} rotated two-call batches per case. Strings are\nresident, modules and caches warmed. Allocations, dispatch, staging, selected\nintegrity and owned copying count. Encoding/imports/SHA-256 checks do not.\n\n| Codec | Native source bytes | None ms | BLAKE3 ms |\n| --- | ---: | ---: | ---: |\n${["pair", "ans", "windows", "utf8", "utf8-compact"].map((n) => "| " + n + " | " + meta.payloads.find((r) => r.packing === n && r.mode === "none").nativeBytes + " | " + value(n + "-none").toFixed(3) + " | " + value(n + "-secure").toFixed(3) + " |").join("\n")}\n\nTuned Base122: ${value("base122-tuned").toFixed(3)} ms. Its permissive decoder\nreturns a view over an oversized buffer; GlyphPack retains selected checks and\nowned exact output. Source sizes use each codec’s intended document charset.\nFull module: ${p["full.min.mjs"].bytes} bytes. Results are host-specific.\n\n[CSV](summary.csv) · [Raw samples and hashes](decode.json).\n`,
);
console.log("Current integration report generated");
