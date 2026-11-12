/* 0BSD, NeoX. Shareable summary and complete warm decode samples. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  dir = path.join(__dirname, "results/utf8-prefix"),
  result = JSON.parse(fs.readFileSync(path.join(dir, "final.json"))),
  screen = JSON.parse(fs.readFileSync(path.join(dir, "screen.json"))),
  compatibility = JSON.parse(
    fs.readFileSync(path.join(dir, "compatibility.json")),
  ),
  manifest = JSON.parse(
    fs.readFileSync(path.join(root, "generated/utf8-prefix/manifest.json")),
  ),
  median = (a) => [...a].sort((a, b) => a - b)[a.length >> 1],
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const delivered = result.environment.variants.find(
  (r) => r.name === "portable-delivered",
);
const prior = JSON.parse(
  fs.readFileSync(path.join(__dirname, "results/utf8-proposal/results.json")),
);
for (const input of prior.environment.inputs)
  if (input.label.startsWith("random-")) {
    const current = path.join(
      root,
      "generated/encoding-comparison",
      input.label + ".bin",
    );
    if (sha(fs.readFileSync(current)) !== input.sha256)
      throw Error("Arithmetic size fixture changed");
  }
if (
  delivered.sha256 !==
  sha(fs.readFileSync(path.join(root, "generated/utf8-prefix/decoder.min.mjs")))
)
  throw Error("Measured decoder changed");
const summary = [];
for (const browser of new Set(result.measurements.map((r) => r.browser))) {
  for (const n of [1024, 65536, 1048576])
    for (const name of [
      "portable-delivered",
      "balanced-delivered",
      "prefix-split",
      "base122-block",
      "base122-reference",
      "base122-counted",
      "base64-native",
      "base64-atob",
      "arithmetic",
    ]) {
      const records = result.measurements.filter(
        (r) => r.browser === browser && r.inputBytes === n && r.name === name,
      );
      if (!records.length) continue;
      if (records.length !== 3) throw Error("Missing processes");
      const variant =
        name.endsWith("-delivered") ? 5 : name === "prefix-split" ? 4 : null;
      const payload =
        variant !== null
          ? manifest.rows.find(
              (r) =>
                r.label.startsWith("random-") &&
                r.inputBytes === n &&
                r.profile === variant,
            ).sourceBytes
          : name.startsWith("base64")
            ? 4 * Math.ceil(n / 3)
            : name.startsWith("base122")
              ? fs.statSync(
                  path.join(
                    root,
                    "generated/encoding-comparison/" +
                      (n === 1024
                        ? "random-1KiB"
                        : n === 65536
                          ? "random-64KiB"
                          : "random-1MiB") +
                      "-none.base122",
                  ),
                ).size
              : name === "arithmetic"
                ? prior.sizes.find(
                    (r) => r.variant === "utf8-data" && r.inputBytes === n,
                  ).payloadBytes
                : "";
      summary.push({
        browser,
        variant: name,
        inputBytes: n,
        payloadBytes: payload,
        overheadPercent:
          payload === "" ? "" : (100 * (payload / n - 1)).toFixed(3),
        decodeMs: median(records.map((r) => r.medianMs)).toFixed(5),
        minProcessMs: Math.min(...records.map((r) => r.medianMs)).toFixed(5),
        maxProcessMs: Math.max(...records.map((r) => r.medianMs)).toFixed(5),
      });
    }
}
function csv(name, rows, columns) {
  fs.writeFileSync(
    path.join(dir, name),
    columns.join(",") +
      "\n" +
      rows.map((r) => columns.map((c) => r[c] ?? "").join(",")).join("\n") +
      "\n",
  );
}
csv(
  "summary.csv",
  summary.filter((r) => r.inputBytes === 1048576),
  Object.keys(summary[0]),
);
csv("sizes-and-times.csv", summary, Object.keys(summary[0]));
for (const [name, data] of [
  ["decode.csv", result],
  ["screen.csv", screen],
]) {
  const flat = data.measurements.map((r) => ({
    ...r,
    ...Object.fromEntries(r.samples.map((s, i) => ["sample" + (i + 1), s])),
  }));
  csv(name, flat, [
    "browser",
    "run",
    "name",
    "profile",
    "inputBytes",
    "medianMs",
    ...Array.from({ length: 9 }, (_, i) => "sample" + (i + 1)),
  ]);
}
const html = fs.readFileSync(
    path.join(root, "generated/utf8-prefix/example.html"),
    "utf8",
  ),
  start = 'globalThis.unpacked=UTF8Prefix.decode("',
  offset = html.lastIndexOf(start) + start.length;
const packet = html.slice(offset, html.lastIndexOf('");</script>'));
const sizes = {
  moduleBytes: delivered.bytes,
  classicBytes: compatibility.builds.find((r) => r.file === "decoder.iife.js")
    .bytes,
  autoPacketBytes: Buffer.byteLength(packet),
  autoHtmlBytes: compatibility.html.prefixBytes,
  base122HtmlBytes: compatibility.html.baselines,
  tableBytes: 8192,
  returnedBuffer: "fresh and exactly sized",
};
fs.writeFileSync(
  path.join(dir, "sizes.json"),
  JSON.stringify(sizes, null, 2) + "\n",
);
console.log(JSON.stringify(sizes));
