/* 0BSD, NeoX. Preserve complete measurements; emit a four-row shareable view.
 * Different campaigns remain labeled. Actual fallback backends are explicit. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  dir = path.join(__dirname, "results/utf8-hybrid"),
  read = (n) => JSON.parse(fs.readFileSync(path.join(dir, n + ".json"))),
  median = (a) => [...a].sort((a, b) => a - b)[a.length >> 1],
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  selected = read("selected"),
  cold = read("cold"),
  builds = JSON.parse(
    fs.readFileSync(path.join(root, "generated/utf8-hybrid/builds.json")),
  );
const phases = ["all", "cast", "selected", "prime", "optimizing-only"];
for (const name of phases)
  for (const c of read(name).environment.candidates)
    if (
      sha(
        fs.readFileSync(
          path.join(root, "generated/utf8-speed", c.name + ".custom.mjs"),
        ),
      ) !== c.sha256
    )
      throw Error("Measured artifact changed: " + name + " " + c.name);
for (const c of cold.sources)
  if (
    sha(
      fs.readFileSync(
        path.join(root, "generated/utf8-speed", c.name + ".custom.mjs"),
      ),
    ) !== c.sha256
  )
    throw Error("Cold artifact changed: " + c.name);
function csv(name, rows, columns = Object.keys(rows[0])) {
  const cell = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  fs.writeFileSync(
    path.join(dir, name),
    columns.join(",") +
      "\n" +
      rows.map((r) => columns.map((c) => cell(r[c])).join(",")).join("\n") +
      "\n",
  );
}
function backend(data, browser, variant) {
  const r = data.verification.find((r) => r.browser === browser),
    n = data.environment.candidates.length,
    index = data.environment.candidates.findIndex((c) => c.name === variant);
  return r.backends[(index - r.run + 1 + n) % n];
}
const compact = [],
  warm = [];
for (const browser of new Set(selected.rows.map((r) => r.browser))) {
  for (const label of ["random-1MiB", "zeros-1MiB"]) {
    const time = (variant) =>
      median(
        selected.rows
          .filter(
            (r) =>
              r.browser === browser &&
              r.variant === variant &&
              r.label === label,
          )
          .map((r) => r.medianMs),
      ).toFixed(3);
    compact.push({
      browser,
      input: label,
      jsDefaultMs: time("delivered"),
      jsBalancedMs: time("balanced"),
      wasmWordsMs: time("stateless-words-scalar"),
      wasmUtf8Ms: time("stateless-utf8-high"),
      jsStringBuiltinMs: time("string-length"),
      jsStringBackend: backend(selected, browser, "string-length"),
    });
  }
  for (const variant of selected.environment.candidates.map((c) => c.name))
    for (const label of new Set(selected.rows.map((r) => r.label))) {
      const rows = selected.rows.filter(
        (r) =>
          r.browser === browser && r.variant === variant && r.label === label,
      );
      if (rows.length !== 3) throw Error("Missing selected processes");
      warm.push({
        browser,
        variant,
        label,
        inputBytes: rows[0].inputBytes,
        backend: backend(selected, browser, variant),
        moduleBytes: selected.environment.candidates.find(
          (c) => c.name === variant,
        ).bytes,
        medianMs: median(rows.map((r) => r.medianMs)).toFixed(5),
        minProcessMs: Math.min(...rows.map((r) => r.medianMs)).toFixed(5),
        maxProcessMs: Math.max(...rows.map((r) => r.medianMs)).toFixed(5),
      });
    }
}
csv("comparison.csv", compact);
csv("warm.csv", warm);
const raw = [];
for (const campaign of phases)
  for (const r of read(campaign).rows)
    raw.push({
      campaign,
      ...r,
      ...Object.fromEntries(r.samples.map((v, i) => ["sample" + (i + 1), v])),
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
const coldSummary = [];
for (const browser of new Set(cold.records.map((r) => r.browser)))
  for (const variant of cold.sources.map((c) => c.name))
    for (const label of new Set(cold.records.map((r) => r.label))) {
      const rows = cold.records.filter(
        (r) =>
          r.browser === browser && r.variant === variant && r.label === label,
      );
      coldSummary.push({
        browser,
        variant,
        label,
        backend: rows[0].backend,
        importMs: median(rows.map((r) => r.importMs)).toFixed(3),
        firstDecodeMs: median(rows.map((r) => r.decodeMs)).toFixed(3),
        totalMs: median(rows.map((r) => r.totalMs)).toFixed(3),
        minProcessMs: Math.min(...rows.map((r) => r.totalMs)).toFixed(3),
        maxProcessMs: Math.max(...rows.map((r) => r.totalMs)).toFixed(3),
      });
    }
csv("cold.csv", coldSummary);
csv(
  "sizes.csv",
  builds.map((r) => ({
    variant: r.name,
    wasmBytes: r.wasmBytes,
    gzipWasmBytes: r.gzipWasmBytes,
    moduleBytes: r.moduleBytes,
    gzipModuleBytes: r.gzipModuleBytes,
  })),
);
fs.writeFileSync(
  path.join(dir, "builds.json"),
  JSON.stringify(builds, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    configurations: builds.length,
    compactRows: compact.length,
    warmRows: warm.length,
    rawRows: raw.length,
    coldRows: coldSummary.length,
  }),
);
