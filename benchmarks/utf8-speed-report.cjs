/* 0BSD, NeoX. Compact, reproducible summaries; never combine unmatched timing
 * campaigns or hide process spread. Full raw samples remain in JSON/CSV. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  dir = path.join(__dirname, "results/utf8-speed");
const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(dir, name + ".json"))),
  selected = read("selected"),
  search = read("search"),
  median = (a) => [...a].sort((a, b) => a - b)[a.length >> 1],
  hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
for (const [name, file] of [
  ["delivered", "decoder.min.mjs"],
  ["balanced", "decoder-balanced.min.mjs"],
]) {
  if (
    hash(fs.readFileSync(path.join(root, "generated/utf8-prefix", file))) !==
    selected.environment.candidates.find((c) => c.name === name).sha256
  )
    throw Error("Measured artifact changed: " + file);
}
const memory = {
  before: 8192,
  delivered: 8192,
  balanced: 8192,
  speculative: 8192,
  wordStores: 8192,
  splitTables: 14336,
  sentinel: 12288,
  stateTable: 73728,
  wideStateTable: 2105344,
  byteInput: 8192,
  bounded: 8192,
  asciiPairs: 8192,
  fullTable: 270336,
  asciiSpec: 8192,
  asciiConditional: 8192,
  narrow: 4096,
  splitModel: 6144,
  smallest: 8192,
};
function csv(name, rows, columns = Object.keys(rows[0])) {
  const cell = (value) => JSON.stringify(String(value ?? ""));
  fs.writeFileSync(
    path.join(dir, name),
    columns.join(",") +
      "\n" +
      rows.map((r) => columns.map((c) => cell(r[c])).join(",")).join("\n") +
      "\n",
  );
}
const compact = [];
for (const browser of new Set(selected.rows.map((r) => r.browser)))
  for (const variant of ["before", "delivered", "balanced"]) {
    const rows = selected.rows.filter(
        (r) =>
          r.browser === browser &&
          r.variant === variant &&
          r.label === "random-1MiB",
      ),
      cold = selected.cold.filter(
        (r) => r.browser === browser && r.variant === variant,
      );
    if (rows.length !== 3) throw Error("Missing matched processes");
    compact.push({
      browser,
      variant,
      inputBytes: 1048576,
      moduleBytes: selected.environment.candidates.find(
        (c) => c.name === variant,
      ).bytes,
      decodeMs: median(rows.map((r) => r.medianMs)).toFixed(5),
      minProcessMs: Math.min(...rows.map((r) => r.medianMs)).toFixed(5),
      maxProcessMs: Math.max(...rows.map((r) => r.medianMs)).toFixed(5),
      first1KiBDecodeMs: median(cold.map((r) => r.firstDecodeMs)).toFixed(5),
      dataUrlImportMs: median(cold.map((r) => r.importMs)).toFixed(5),
    });
  }
csv("summary.csv", compact);
const screened = [];
for (const browser of new Set(search.rows.map((r) => r.browser)))
  for (const c of search.environment.candidates) {
    const value = (label) =>
        median(
          search.rows
            .filter(
              (r) =>
                r.browser === browser &&
                r.variant === c.name &&
                r.label === label,
            )
            .map((r) => r.medianMs),
        ),
      baseline = search.rows.find(
        (r) =>
          r.browser === browser &&
          r.variant === "before" &&
          r.label === "random-1MiB",
      ).medianMs;
    screened.push({
      browser,
      variant: c.name,
      moduleBytes: c.bytes,
      lookupBytes: memory[c.name] ?? "",
      random1MiBMs: value("random-1MiB").toFixed(5),
      relativeTime: (value("random-1MiB") / baseline).toFixed(3),
      zeros1MiBMs: value("zeros-1MiB").toFixed(5),
      sequential1MiBMs: value("sequential-1MiB").toFixed(5),
    });
  }
csv("candidates.csv", screened);
const raw = [];
for (const [campaign, data] of [
  ["selected", selected],
  ["search", search],
])
  for (const r of data.rows)
    raw.push({
      campaign,
      ...r,
      ...Object.fromEntries(r.samples.map((s, i) => ["sample" + (i + 1), s])),
    });
csv("decode.csv", raw, [
  "campaign",
  "browser",
  "run",
  "variant",
  "label",
  "inputBytes",
  "medianMs",
  ...Array.from({ length: 9 }, (_, i) => "sample" + (i + 1)),
]);
fs.copyFileSync(
  path.join(__dirname, "results/utf8-prefix/compatibility.json"),
  path.join(dir, "compatibility.json"),
);
console.log(
  JSON.stringify({
    matchedRows: compact.length,
    screenRows: screened.length,
    rawRows: raw.length,
  }),
);
