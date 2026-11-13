/* 0BSD, NeoX. Matched complete calls on recorded Chromium. Encoding, module
 * loading, warm-up and output hashes are outside the decode timers. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  http = require("node:http"),
  os = require("node:os"),
  esbuild = require("esbuild"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  v = require("../generated/integration/vectors.json"),
  dest = path.join(__dirname, "results/integration"),
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  url = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64"),
  runs = +(process.env.INTEGRATION_RUNS || 3),
  rounds = +(process.env.INTEGRATION_ROUNDS || 9);
const source = (name, file) => {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  return {
    name,
    file,
    url: url(code),
    bytes: Buffer.byteLength(code),
    sha256: sha(code),
  };
};
const sources = [
  source(
    "previous",
    "benchmarks/experiments/utf8-rival/selected-before-integration.min.mjs",
  ),
  source("raw", "dist/utf8-raw.min.mjs"),
  source("full", "dist/full.min.mjs"),
  source("core", "generated/integration/utf8-core.mjs"),
  source("strict", "generated/integration/both-strict.mjs"),
  source("secure", "dist/utf8.min.mjs"),
];
const peer = esbuild.buildSync({
  stdin: {
    contents:
      "export{groupUnroll as decode}from './benchmarks/experiments/utf8-rival/base122.mjs';export{Base122}from './benchmarks/vendor/encoding-bench/code4fukui-Base122-Base122.js';",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  minify: true,
  target: "chrome109",
}).outputFiles[0].text;
sources.push({
  name: "base122",
  url: url(peer),
  bytes: Buffer.byteLength(peer),
  sha256: sha(peer),
});
(async () => {
  const encoder = await import(url(peer)),
    input = fs.readFileSync(v.input),
    expected = sha(input),
    base122 = encoder.Base122.encode(new Uint8Array(input)),
    packets = Object.fromEntries(
      v.large.map((r) => [
        r.packing + "-" + r.mode,
        fs.readFileSync(r.file, "utf8"),
      ]),
    );
  const jobs = [
    {
      name: "previous-raw",
      module: "previous",
      method: "decode",
      text: packets["utf8-none"].slice(2),
    },
    {
      name: "current-raw",
      module: "raw",
      method: "decode",
      text: packets["utf8-none"].slice(2),
    },
    {
      name: "utf8-core",
      module: "core",
      method: "binary",
      text: packets["utf8-none"],
    },
    {
      name: "utf8-strict-js",
      module: "strict",
      method: "binary",
      text: packets["utf8-none"],
    },
    {
      name: "utf8-secure-fixed",
      module: "secure",
      method: "binary",
      text: packets["utf8-secure"],
    },
    {
      name: "base122-tuned",
      module: "base122",
      method: "decode",
      text: base122,
    },
  ];
  for (const packing of ["pair", "ans", "windows", "utf8", "utf8-compact"])
    for (const mode of ["none", "secure"])
      jobs.push({
        name: packing + "-" + mode,
        module: "full",
        method: "binary",
        text: packets[packing + "-" + mode],
        options: { verifyFormat: true, verifyData: mode, memoryHeavy: false },
        compact: packing === "utf8-compact",
      });
  jobs.push({
    name: "utf8-unchecked",
    module: "full",
    method: "binary",
    text: packets["utf8-none"],
    options: { verifyFormat: false, verifyData: "none", memoryHeavy: false },
  });
  const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.end("<!doctype html>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const records = [];
  try {
    for (let run = 1; run <= runs; run++) {
      const browser = await chromium.launch({
        executablePath: "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox"],
      });
      try {
        if (browser.version() !== require("./chromium.json").version)
          throw Error("Recorded Chromium changed");
        const page = await browser.newPage();
        await page.goto("http://127.0.0.1:" + server.address().port);
        const result = await page.evaluate(
          async ({ sources, jobs, expected, rounds, run }) => {
            const modules = Object.fromEntries(
              await Promise.all(
                sources.map(async (s) => [s.name, await import(s.url)]),
              ),
            );
            modules.full.warmup([
              "pair",
              "ans",
              "windows",
              "utf8",
              "utf8-compact",
            ]);
            modules.raw.warmup();
            modules.previous.warmup();
            modules.core.warmup();
            modules.strict.warmup();
            modules.secure.warmup();
            let sink = 0;
            const rows = jobs.map((j) => ({ ...j, samples: [] }));
            const measure = (j, n) => {
              const fn = modules[j.module][j.method],
                t = performance.now();
              for (let i = 0; i < n; i++) {
                const b = fn(j.text, j.options);
                sink = (sink + b.length + b[i % b.length]) | 0;
              }
              return (performance.now() - t) / n;
            };
            for (const j of rows) {
              const bytes = modules[j.module][j.method](j.text, j.options),
                actual = Array.from(
                  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
                  (v) => v.toString(16).padStart(2, "0"),
                ).join("");
              if (actual !== expected || bytes.length !== 1048576)
                throw Error("Benchmark bytes " + j.name);
              measure(j, j.compact ? 1 : 16);
            }
            for (let r = 0; r < rounds; r++)
              for (let k = 0; k < rows.length; k++) {
                const j = rows[(k + r * 7 + run) % rows.length];
                if (j.compact && r >= 3) continue;
                j.samples.push(measure(j, j.compact ? 1 : 2));
              }
            globalThis.sink = sink;
            return rows.map((j) => ({
              name: j.name,
              samples: j.samples,
              medianMs: [...j.samples].sort((a, b) => a - b)[
                j.samples.length >> 1
              ],
              callsPerBatch: j.compact ? 1 : 2,
            }));
          },
          { sources, jobs, expected, rounds, run },
        );
        records.push(
          ...result.map((r) => ({ ...r, run, browser: browser.version() })),
        );
        console.log(
          JSON.stringify({
            run,
            browser: browser.version(),
            comparisons: result.length,
          }),
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  fs.mkdirSync(dest, { recursive: true });
  const meta = {
    inputBytes: input.length,
    inputSha256: expected,
    recordedAt: new Date().toISOString(),
    architecture: process.arch,
    cpu: os.cpus()[0]?.model,
    runs,
    rounds,
    scope: `Resident string to fresh owned bytes; includes requested integrity, JS/Wasm staging and copying. Compact uses up to three measured single-call batches; other variants use ${rounds} two-call batches. Encoding, imports, warmup and SHA-256 output checks are excluded.`,
    sources: sources.map(({ url, ...r }) => r),
    payloads: v.large.map(({ file, ...r }) => r),
    base122Bytes: Buffer.byteLength(base122),
  };
  fs.writeFileSync(
    path.join(dest, "decode.json"),
    JSON.stringify({ meta, records }, null, 2) + "\n",
  );
  const median = (a) => [...a].sort((a, b) => a - b)[a.length >> 1],
    rows = jobs.map((j) => {
      const samples = records
        .filter((r) => r.name === j.name)
        .map((r) => r.medianMs);
      return {
        name: j.name,
        medianMs: median(samples),
        min: Math.min(...samples),
        max: Math.max(...samples),
      };
    });
  fs.writeFileSync(
    path.join(dest, "summary.csv"),
    "decoder,input_bytes,median_ms,process_min_ms,process_max_ms\n" +
      rows
        .map((r) =>
          [
            r.name,
            input.length,
            r.medianMs.toFixed(3),
            r.min.toFixed(3),
            r.max.toFixed(3),
          ].join(","),
        )
        .join("\n") +
      "\n",
  );
  console.log(JSON.stringify(rows));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
