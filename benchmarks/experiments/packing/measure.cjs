// 0BSD, NeoX. Complete warmed calls: fresh output, selected verification and
// JS/Wasm bridge copies. A fresh page owns ONE packet/module at a time. The
// setup transport avoids serializing large Unicode strings through DevTools.
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../.."),
  dir = path.join(root, "generated/packing");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json")));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const median = (a) => {
  a = a.slice().sort((a, b) => a - b);
  return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2;
};
const names = process.env.PACK_VARIANTS?.split(",");
const variants = manifest.variants.filter(
  (v) => !names || names.includes(v.name),
);
const datasets = (
  process.env.PACK_DATASETS || "random-64KiB,random-1MiB"
).split(",");
const kinds = (process.env.PACK_KINDS || "0,2").split(",").map(Number);
const runs = Number(process.env.PACK_RUNS || 1);
const outFile = path.resolve(process.argv[2] || path.join(dir, "screen.json"));
const browserPath = process.env.CHROMIUM_BIN || "/usr/bin/chromium";
const version =
  process.env.CHROMIUM_VERSION || require("../../chromium.json").version;
(async () => {
  assert(variants.length && runs >= 1 && runs <= 5);
  const modules = variants.map((v) => {
    const b = fs.readFileSync(path.join(root, v.module));
    return {
      ...v,
      sha256: sha(b),
      url: "data:text/javascript;base64," + b.toString("base64"),
    };
  });
  const cases = manifest.rows.filter(
    (r) => datasets.includes(r.dataset) && kinds.includes(r.kind),
  );
  const files = [
    ...new Set(
      cases.flatMap((r) => variants.map((v) => r.packets[v.packet].text)),
    ),
  ];
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html>");
      return;
    }
    const match = /^\/packet\/(\d+)$/.exec(req.url),
      file = match && files[Number(match[1])];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(path.join(root, file)).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const report = {
    schema: 1,
    pass: false,
    browser: null,
    architecture: os.arch(),
    cpuModels: [...new Set(os.cpus().map((c) => c.model))],
    date: new Date().toISOString(),
    manifestSha256: sha(fs.readFileSync(path.join(dir, "manifest.json"))),
    modules: modules.map(({ url, ...v }) => v),
    methodology: {
      runs,
      warmups: 3,
      measured: 9,
      calibration: "each variant >=2 ms, cap 2048",
      order:
        "fresh page per codec/dataset/policy; rotate codec order by run and case; complete calls on one resident restored string",
      included:
        "fresh owned output, structural checks, selected hash and JS/Wasm copies",
      excluded:
        "source parsing/restoration, local setup transport, imports, setup, correctness SHA-256",
      limits:
        "unpinned host; warm caches; batch averages are not individual-call tails",
    },
    rows: [],
  };
  try {
    for (let run = 0; run < runs; run++) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: browserPath,
        args: ["--no-sandbox"],
      });
      try {
        report.browser = browser.version();
        assert.equal(report.browser, version);
        for (let ci = 0; ci < cases.length; ci++) {
          const row = cases[ci],
            expected = fs
              .readFileSync(path.join(root, row.expected))
              .subarray(0, row.bytes),
            expectedSha = sha(expected);
          for (let j = 0; j < modules.length; j++) {
            const def = modules[(j + run + ci) % modules.length],
              page = await browser.newPage();
            try {
              await page.goto(origin);
              const packetUrl =
                origin +
                "/packet/" +
                files.indexOf(row.packets[def.packet].text);
              const result = await page.evaluate(
                async ({ url, packetUrl, kind, size, expectedSha }) => {
                  const engine = await import(url);
                  const raw = await (await fetch(packetUrl)).arrayBuffer();
                  const text = new TextDecoder("utf-16le", {
                    fatal: true,
                    ignoreBOM: true,
                  }).decode(raw);
                  const check = engine.binary(text, kind);
                  if (
                    check.length !== size ||
                    check.byteOffset !== 0 ||
                    check.buffer.byteLength !==
                      size + (kind === 2 ? 32 : kind === 1 ? 4 : 0)
                  )
                    throw Error("Output shape");
                  const hash = new Uint8Array(
                    await crypto.subtle.digest("SHA-256", check),
                  );
                  const hex = Array.from(hash, (b) =>
                    b.toString(16).padStart(2, "0"),
                  ).join("");
                  if (hex !== expectedSha) throw Error("Wrong bytes");
                  let batch = 1,
                    sink = 0;
                  function call() {
                    const t = performance.now();
                    for (let k = 0; k < batch; k++) {
                      const b = engine.binary(text, kind);
                      sink ^= b[(k * 997) % b.length] || 0;
                    }
                    return (performance.now() - t) / batch;
                  }
                  while (call() * batch < 2 && batch < 2048) batch *= 2;
                  for (let k = 0; k < 3; k++) call();
                  const samples = [];
                  for (let k = 0; k < 9; k++) samples.push(call());
                  return {
                    batch,
                    samples,
                    sink,
                    sha256: hex,
                    wasmRetainedBytes: engine.memory(),
                  };
                },
                {
                  url: def.url,
                  packetUrl,
                  kind: row.kind,
                  size: row.bytes,
                  expectedSha,
                },
              );
              report.rows.push({
                ...result,
                name: def.name,
                run: run + 1,
                dataset: row.dataset,
                bytes: row.bytes,
                kind: row.kind,
                sourceBytes: row.packets[def.packet].sourceBytes,
              });
            } finally {
              await page.close();
            }
          }
          console.log(
            JSON.stringify({
              run: run + 1,
              dataset: row.dataset,
              kind: row.kind,
              variants: modules.length,
            }),
          );
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  const groups = new Map();
  for (const r of report.rows) {
    const key = [r.name, r.dataset, r.kind].join("/");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  report.summary = [...groups.values()].map((g) => {
    const times = g.map((r) => median(r.samples));
    return {
      name: g[0].name,
      dataset: g[0].dataset,
      bytes: g[0].bytes,
      kind: g[0].kind,
      runs: g.length,
      ms: median(times),
      runMin: Math.min(...times),
      runMax: Math.max(...times),
      sourceBytes: g[0].sourceBytes,
    };
  });
  report.pass = true;
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({ pass: true, cases: report.rows.length, file: outFile }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
