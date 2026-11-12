/* 0BSD, NeoX. Matched medians and raw samples for compact/default BLAKE3. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "benchmarks/results/compact-hash");
const hash = JSON.parse(fs.readFileSync(path.join(out, "hash.json"))),
  decode = JSON.parse(
    fs.readFileSync(
      path.join(root, "generated/optimization/compact-check-long.json"),
    ),
  );
for (const candidate of decode.environment.candidates) {
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, candidate.module)))
    .digest("hex");
  if (actual !== candidate.sha256) throw Error("Measured module changed");
}
// Keep the exact end-to-end environment, artifact hashes and all fifteen
// batches beside the isolated-hash measurements, rather than only a summary.
fs.copyFileSync(
  path.join(root, "generated/optimization/compact-check-long.json"),
  path.join(out, "decode.json"),
);
fs.copyFileSync(
  path.join(root, "generated/optimization/compact-check-long.csv"),
  path.join(out, "decode.csv"),
);
const median = (values) =>
  [...values].sort((a, b) => a - b)[values.length >> 1];
const summary = [];
for (const [scope, data] of [
  ["hash-only", hash],
  ["decode", decode],
]) {
  for (const browser of new Set(data.rows.map((r) => r.browser))) {
    for (const inputBytes of new Set(data.rows.map((r) => r.inputBytes))) {
      const row = { scope, browser, inputBytes };
      for (const variant of ["default", "compact"]) {
        const times = data.rows
          .filter(
            (r) =>
              r.browser === browser &&
              r.inputBytes === inputBytes &&
              r.variant === variant + (scope === "decode" ? "-baseline" : ""),
          )
          .map((r) => r.medianMs);
        if (times.length !== data.environment.runs)
          throw Error("Incomplete comparison");
        row[variant + "Ms"] = median(times);
        row[variant + "MinRunMs"] = Math.min(...times);
        row[variant + "MaxRunMs"] = Math.max(...times);
      }
      row.compactExtraTimePercent = 100 * (row.compactMs / row.defaultMs - 1);
      summary.push(row);
    }
  }
}
const columns = [
  "scope",
  "browser",
  "inputBytes",
  "defaultMs",
  "compactMs",
  "compactExtraTimePercent",
  "defaultMinRunMs",
  "defaultMaxRunMs",
  "compactMinRunMs",
  "compactMaxRunMs",
];
fs.writeFileSync(
  path.join(out, "summary.csv"),
  columns.join(",") +
    "\n" +
    summary.map((r) => columns.map((c) => r[c]).join(",")).join("\n") +
    "\n",
);
for (const row of summary) console.log(JSON.stringify(row));
