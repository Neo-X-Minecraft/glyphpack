/* 0BSD, NeoX. Retain compact CSVs plus raw batches and exact artifact hashes. */
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  input = path.join(root, "generated/optimization"),
  output = path.join(root, "benchmarks/results/decoder-optimization");
fs.mkdirSync(output, { recursive: true });
const secure = JSON.parse(fs.readFileSync(path.join(input, "retained.json"))),
  policies = JSON.parse(fs.readFileSync(path.join(input, "all-policies.json")));
const columns = [
  "browser",
  "run",
  "profile",
  "variant",
  "packing",
  "inputBytes",
  "moduleBytes",
  "integrity",
  "verifyFormat",
  "memoryHeavy",
  "medianMs",
  "minMs",
  "maxMs",
  ...Array.from({ length: 9 }, (_, i) => "sample" + (i + 1)),
];
const csv = (rows, cols) =>
  cols.join(",") +
  "\n" +
  rows.map((r) => cols.map((k) => r[k] ?? "").join(",")).join("\n") +
  "\n";
const names = {
  baseline: "before",
  "default-baseline": "default",
  "compact-baseline": "compact",
};
function flatten(rows) {
  return rows.map((r) => ({
    ...r,
    variant: names[r.variant] || r.variant,
    integrity: r.options?.verifyData || "secure",
    verifyFormat: r.options?.verifyFormat ?? true,
    memoryHeavy: r.options?.memoryHeavy ?? false,
    ...Object.fromEntries(r.samples.map((s, i) => ["sample" + (i + 1), s])),
  }));
}
fs.writeFileSync(
  path.join(output, "decode.csv"),
  csv(flatten(secure.rows), columns),
);
fs.writeFileSync(
  path.join(output, "policies.csv"),
  csv(flatten(policies.rows), columns),
);
const warm = secure.warmups.map((r) => ({
  ...r,
  variant: names[r.variant] || r.variant,
  ...Object.fromEntries(r.samples.map((s, i) => ["sample" + (i + 1), s])),
}));
fs.writeFileSync(
  path.join(output, "warmup.csv"),
  csv(warm, [
    "browser",
    "run",
    "profile",
    "variant",
    "batch",
    "isolated",
    "medianMs",
    "minMs",
    "maxMs",
    ...Array.from({ length: 9 }, (_, i) => "sample" + (i + 1)),
  ]),
);
fs.writeFileSync(
  path.join(output, "environment.json"),
  JSON.stringify(
    {
      baseline: "6214588",
      secure: secure.environment,
      policies: policies.environment,
    },
    null,
    2,
  ) + "\n",
);
const median = (a) => a.sort((a, b) => a - b)[a.length >> 1];
const sizeRows = ["recommended", "recommended-full", "full"].map((profile) => {
  const c = secure.environment.candidates.filter((c) => c.profile === profile);
  const before = c.find((c) => c.variant === "baseline").moduleBytes,
    normal = c.find((c) => c.variant === "default-baseline").moduleBytes,
    compact = c.find((c) => c.variant === "compact-baseline").moduleBytes;
  return {
    profile,
    before,
    default: normal,
    compact,
    defaultSavedPercent: ((1 - normal / before) * 100).toFixed(2),
    compactSavedPercent: ((1 - compact / before) * 100).toFixed(2),
  };
});
fs.writeFileSync(
  path.join(output, "sizes.csv"),
  csv(sizeRows, [
    "profile",
    "before",
    "default",
    "compact",
    "defaultSavedPercent",
    "compactSavedPercent",
  ]),
);
const warmSummary = [];
for (const browser of [...new Set(warm.map((r) => r.browser))])
  for (const profile of ["recommended", "recommended-full", "full"]) {
    const a = warm.filter(
      (r) => r.browser === browser && r.profile === profile,
    );
    warmSummary.push({
      browser,
      profile,
      beforeUs:
        1000 *
        median(a.filter((r) => r.variant === "before").map((r) => r.medianMs)),
      defaultUs:
        1000 *
        median(a.filter((r) => r.variant === "default").map((r) => r.medianMs)),
    });
    console.log(
      browser,
      profile,
      "warm-up speedup",
      (
        median(a.filter((r) => r.variant === "before").map((r) => r.medianMs)) /
        median(a.filter((r) => r.variant === "default").map((r) => r.medianMs))
      ).toFixed(2),
    );
  }
fs.writeFileSync(
  path.join(output, "warmup-summary.csv"),
  csv(warmSummary, ["browser", "profile", "beforeUs", "defaultUs"]),
);
