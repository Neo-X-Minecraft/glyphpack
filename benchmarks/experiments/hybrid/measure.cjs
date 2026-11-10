/* Component experiments execute inside Chromium. Fixture loading and source
 * evaluation precede timing; complete hybrid calls will be a separate stage. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../.."),
  output = path.join(root, "generated/performance/components.json");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "generated/history/manifest.json")),
);
const median = (a) => {
  a = a.slice().sort((a, b) => a - b);
  return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2;
};
const moduleFiles = {
  baseline: "generated/performance/hashes-baseline.wasm",
  unrolled: "generated/performance/hashes-unrolled.wasm",
  simd: "generated/performance/hashes-simd.wasm",
  "simd-loop": "generated/performance/hashes-simd-loop.wasm",
};
const sources = {
  js: fs.readFileSync(
    path.join(root, "tests/fixtures/blake3-unrolled.js"),
    "utf8",
  ),
  modules: Object.fromEntries(
    Object.entries(moduleFiles).map(([id, file]) => [
      id,
      fs.readFileSync(path.join(root, file)).toString("base64"),
    ]),
  ),
};
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, "." + decodeURIComponent(req.url));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, b) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": file.endsWith(".html")
          ? "text/html"
          : "application/octet-stream",
      });
      res.end(b);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const report = {
    pass: false,
    browser:
      process.env.CHROMIUM_VERSION || require("../../chromium.json").version,
    date: new Date().toISOString(),
    sourceHashes: Object.fromEntries(
      Object.entries(moduleFiles).map(([id, file]) => [
        id,
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
    methodology: {
      runs: 3,
      warmups: 3,
      measured: 9,
      calibration: "2 ms per batch",
      timed:
        "synchronous hash API; copy variants include JS->Wasm input copy; resident variants preload outside timing",
      limits: "component costs are not complete decoder timings",
    },
    rows: [],
  };
  try {
    for (let run = 0; run < 3; run++) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_BIN || "/usr/bin/chromium",
        args: ["--no-sandbox"],
      });
      try {
        assert.equal(browser.version(), report.browser);
        const page = await browser.newPage();
        await page.goto(origin + "/benchmarks/blank.html");
        await page.evaluate(async (sources) => {
          window.jsHash = new Function(sources.js + ";return blake3")();
          window.hashApis = {};
          for (const [name, b64] of Object.entries(sources.modules)) {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            hashApis[name] = (
              await WebAssembly.instantiate(bytes)
            ).instance.exports;
          }
        }, sources);
        for (const input of manifest.inputs.filter(
          (r) =>
            r.original ||
            [
              "random-128",
              "random-2048",
              "random-65536",
              "random-1048576",
            ].includes(r.label),
        )) {
          const rows = await page.evaluate(
            async ({ input, run }) => {
              const bytes = new Uint8Array(
                  await (
                    await fetch("/generated/history/" + input.binary)
                  ).arrayBuffer(),
                ),
                hex = (b) =>
                  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join(
                    "",
                  ),
                entries = [{ id: "JS", fn: () => jsHash(bytes) }];
              for (const [name, api] of Object.entries(hashApis)) {
                const ptr = api.reserve(bytes.length),
                  view = new Uint8Array(api.memory.buffer, ptr, bytes.length);
                view.set(bytes);
                api.blake3(bytes.length);
                const get = () =>
                  new Uint8Array(
                    api.memory.buffer,
                    api.blake3(bytes.length),
                    32,
                  ).slice();
                entries.push(
                  { id: name + "-resident", fn: get },
                  {
                    id: name + "-copy",
                    fn: () => {
                      view.set(bytes);
                      return get();
                    },
                  },
                );
              }
              for (const e of entries) {
                if (hex(e.fn()) !== input.blake3)
                  throw Error(e.id + " digest mismatch");
                e.batch = 1;
                e.times = [];
                for (;;) {
                  let fastest = Infinity;
                  for (let j = 0; j < 2; j++) {
                    const start = performance.now();
                    for (let n = 0; n < e.batch; n++) e.fn();
                    fastest = Math.min(fastest, performance.now() - start);
                  }
                  if (fastest >= 2 || e.batch >= 4096) break;
                  e.batch *= 2;
                }
              }
              let sink = 0;
              for (let round = -3; round < 9; round++)
                for (let j = 0; j < entries.length; j++) {
                  const e =
                      entries[
                        (j + round + run + entries.length) % entries.length
                      ],
                    start = performance.now();
                  for (let n = 0; n < e.batch; n++) sink ^= e.fn()[0];
                  e.times.push({
                    round,
                    order: j,
                    phase: round < 0 ? "warmup" : "measured",
                    ms: (performance.now() - start) / e.batch,
                  });
                }
              return entries.map(({ fn, ...e }) => ({ ...e, sink }));
            },
            { input, run },
          );
          report.rows.push(
            ...rows.map((r) => ({
              ...r,
              run: run + 1,
              dataset: input.label,
              bytes: input.bytes,
              medianMs: median(
                r.times.filter((t) => t.phase === "measured").map((t) => t.ms),
              ),
            })),
          );
          console.log(
            JSON.stringify({
              run: run + 1,
              dataset: input.label,
              paths: rows.length,
            }),
          );
        }
      } finally {
        await browser.close();
      }
    }
    report.pass = true;
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({ pass: true, rows: report.rows.length, output }),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
