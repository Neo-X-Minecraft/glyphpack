/* 0BSD, NeoX. Decode-only comparison of the production codecs, all 12 policies.
 * Inputs/imports are prepared before timing. Rotating order, five rounds, warm
 * calls and consumed results reduce order/JIT bias. These are local timings,
 * not universal cutoffs. No private or historical media fixtures are used. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/codec-bench"),
  manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"))),
  source = fs.readFileSync(path.join(root, "dist/full.min.mjs"), "utf8");
(async () => {
  const server = http.createServer((req, res) => {
    const m = /^\/(\d+)$/.exec(req.url);
    if (!m) {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html>");
      return;
    }
    fs.createReadStream(path.join(root, manifest.rows[+m[1]].file)).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const rows = [];
  try {
    for (const bin of [
      process.env.CHROMIUM_BIN || "/usr/bin/chromium",
      process.env.CHROMIUM109_BIN ||
        path.join(root, ".tools/chromium109/chromium"),
    ].filter((b, i) => i === 0 || fs.existsSync(b))) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: bin,
        args: ["--no-sandbox"],
      });
      try {
        const page = await browser.newPage();
        await page.goto("http://127.0.0.1:" + server.address().port);
        await page.evaluate(
          async ({ url, meta }) => {
            globalThis.binary = (await import(url)).binary;
            globalThis.inputs = await Promise.all(
              meta.map(async (_, i) =>
                new TextDecoder("utf-16le", {
                  fatal: true,
                  ignoreBOM: true,
                }).decode(await (await fetch("/" + i)).arrayBuffer()),
              ),
            );
          },
          {
            url:
              "data:text/javascript;base64," +
              Buffer.from(source).toString("base64"),
            meta: manifest.rows,
          },
        );
        const data = await page.evaluate((meta) => {
          const jobs = [];
          let sink = 0;
          for (let i = 0; i < meta.length; i++)
            for (const verifyFormat of [false, true])
              for (const memoryHeavy of [false, true])
                jobs.push({ i, verifyFormat, memoryHeavy, samples: [] });
          // Verify full output before timing. Every fixture is the same LCG prefix.
          for (let i = 0; i < meta.length; i++) {
            const out = binary(inputs[i], { verifyData: meta[i].integrity });
            if (out.length !== meta[i].bytes) throw Error("length");
            let seed = 815;
            for (const b of out) {
              seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
              if (b !== seed >>> 24) throw Error("bytes");
            }
          }
          const run = (j, count) => {
            const opt = {
                verifyData: meta[j.i].integrity,
                verifyFormat: j.verifyFormat,
                memoryHeavy: j.memoryHeavy,
              },
              text = inputs[j.i];
            const t = performance.now();
            for (let k = 0; k < count; k++) {
              const out = binary(text, opt);
              sink = (sink + out.length + out[k % out.length]) >>> 0;
            }
            return (performance.now() - t) / count;
          };
          for (const j of jobs) run(j, 8);
          for (let round = 0; round < 5; round++)
            for (let k = 0; k < jobs.length; k++) {
              const j = jobs[(k + round * 31) % jobs.length],
                n = meta[j.i].bytes;
              const batch =
                n <= 1024 ? 1000 : n <= 65536 ? 40 : n <= 1048576 ? 4 : 1;
              j.samples.push(run(j, batch));
            }
          globalThis.sink = sink;
          return jobs.map((j) => {
            const a = [...j.samples].sort((a, b) => a - b);
            return { ...j, medianMs: a[2], minMs: a[0], maxMs: a[4] };
          });
        }, manifest.rows);
        assert.equal(data.length, 144);
        for (const d of data) {
          const { i, ...timing } = d;
          rows.push({
            browser: browser.version(),
            ...manifest.rows[i],
            ...timing,
          });
        }
        console.log(
          JSON.stringify({ browser: browser.version(), cases: data.length }),
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  const environment = {
    recordedAt: new Date().toISOString(),
    fixtureGenerator: "examples/codec_bench.rs; LCG seed 815",
    sourceSizeScope:
      "packet including indicator/header/states/digest; excludes shell and decoder",
    arch: process.arch,
    platform: process.platform,
    cpu: os.cpus()[0].model,
    node: process.version,
    moduleSha256: crypto.createHash("sha256").update(source).digest("hex"),
    moduleBytes: Buffer.byteLength(source),
    rounds: 5,
    order: "rotating",
    scope:
      "warm full binary() including input copy, chosen verification, owned output copy; excludes parsing/import; memory arenas and tables reused",
    encoding: "sampled automatic mask; no general compression",
  };
  fs.writeFileSync(
    path.join(dir, "results.json"),
    JSON.stringify({ environment, rows }, null, 2) + "\n",
  );
  const columns = [
    "browser",
    "bytes",
    "packing",
    "integrity",
    "verifyFormat",
    "memoryHeavy",
    "sourceBytes",
    "medianMs",
    "minMs",
    "maxMs",
  ];
  fs.writeFileSync(
    path.join(dir, "results.csv"),
    columns.join(",") +
      "\n" +
      rows.map((r) => columns.map((k) => r[k]).join(",")).join("\n") +
      "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
