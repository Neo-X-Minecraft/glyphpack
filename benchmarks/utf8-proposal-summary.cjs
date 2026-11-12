/* 0BSD, NeoX. Small, shareable 1 MiB comparison; raw candidates stay separate. */
const fs = require("node:fs"),
  path = require("node:path");
const dir = path.join(__dirname, "results/utf8-proposal"),
  result = JSON.parse(fs.readFileSync(path.join(dir, "results.json"))),
  median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
const rows = [];
for (const browser of new Set(result.measurements.map((r) => r.browser))) {
  for (const variant of [
    "base64",
    "base122",
    "utf8-data",
    "utf8-fast-experiment",
    "utf8-clean",
  ]) {
    const timings = result.measurements.filter(
      (r) => r.browser === browser && r.inputBytes === 1048576,
    );
    let chosen = variant;
    if (variant === "base64" || variant === "base122") {
      const candidates = [
        ...new Set(
          timings
            .filter((r) => r.variant.startsWith(variant + "-"))
            .map((r) => r.variant),
        ),
      ];
      chosen = candidates.sort(
        (a, b) =>
          median(
            timings.filter((r) => r.variant === a).map((r) => r.medianMs),
          ) -
          median(timings.filter((r) => r.variant === b).map((r) => r.medianMs)),
      )[0];
    }
    const size = result.sizes.find(
        (r) => r.variant === variant && r.inputBytes === 1048576,
      ),
      times = timings
        .filter((r) => r.variant === chosen)
        .map((r) => r.medianMs);
    if (times.length !== result.environment.runs) throw Error("Missing runs");
    rows.push({
      browser,
      variant,
      implementation: chosen,
      inputBytes: size.inputBytes,
      payloadBytes: size.payloadBytes,
      overheadPercent: (
        100 *
        (size.payloadBytes / size.inputBytes - 1)
      ).toFixed(3),
      decodeMs: median(times).toFixed(4),
      integrity: "none",
      jsonStringBytes: size.jsonStringBytes,
      htmlBytes: size.htmlBytes ?? "",
    });
  }
}
const columns = Object.keys(rows[0]);
fs.writeFileSync(
  path.join(dir, "summary.csv"),
  columns.join(",") +
    "\n" +
    rows.map((r) => columns.map((c) => r[c]).join(",")).join("\n") +
    "\n",
);
