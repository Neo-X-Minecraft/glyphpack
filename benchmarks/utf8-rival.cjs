/* 0BSD, NeoX. Same resident bytes, actual UTF-8 payloads and complete decode
 * calls. Base122 keeps its permissive/view-returning policy, favoring its speed. */
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  http = require("node:http"),
  os = require("node:os"),
  { chromium } = require("playwright"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, ".."),
  work = path.join(root, "generated/utf8-rival"),
  dest = path.join(__dirname, "results/utf8-rival"),
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  uri = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64"),
  runs = Number(process.env.RIVAL_RUNS || 1),
  rounds = Number(process.env.RIVAL_ROUNDS || 5),
  label = process.env.RIVAL_LABEL || "screen",
  build = (name, code, family) => {
    const text = esbuild.buildSync({
      stdin: { contents: code, resolveDir: root },
      bundle: true,
      write: false,
      minify: true,
      format: "esm",
      target: "chrome109",
      define: { UTF8_FORMAT_RUNTIME: "false", UTF8_VERIFY_FORMAT: "true" },
    }).outputFiles[0].text;
    fs.writeFileSync(path.join(work, name + ".mjs"), text);
    return {
      name,
      family,
      code: text,
      moduleBytes: Buffer.byteLength(text),
      sha256: sha(text),
    };
  };
fs.mkdirSync(dest, { recursive: true });
const previous = fs.readFileSync(
  path.join(root, "benchmarks/experiments/utf8-rival/baseline.min.mjs"),
  "utf8",
);
const sources = [
  {
    name: "utf8-previous",
    family: "utf8",
    code: previous,
    moduleBytes: Buffer.byteLength(previous),
    sha256: sha(previous),
  },
  build(
    "utf8-raw",
    "export{decode,warmup}from'./src/utf8-raw/decoder.mjs'",
    "utf8",
  ),
  build(
    "utf8-unroll",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/unroll.mjs'",
    "utf8",
  ),
  build(
    "utf8-bounded",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/bounded.mjs'",
    "utf8",
  ),
  ...["split", "split-bounded"].map((n) =>
    build(
      "utf8-" + n,
      `export{decode,warmup}from'./benchmarks/experiments/utf8-rival/${n}.mjs'`,
      "utf8",
    ),
  ),
  build(
    "utf8-scalar",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/scalar.mjs'",
    "utf8",
  ),
  build(
    "utf8-block",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/block.mjs'",
    "utf8",
  ),
  ...["block-view", "block-first"].map((n) =>
    build(
      "utf8-" + n,
      `export{decode,warmup}from'./benchmarks/experiments/utf8-rival/${n}.mjs'`,
      "utf8",
    ),
  ),
  ...["inline122", "block122", "counted122"].map((n) =>
    build(
      "base122-" + n,
      `export{${n} as decode}from'./benchmarks/fixtures/encoding-competitors.js'`,
      "base122",
    ),
  ),
  build(
    "base122-reference",
    "export{reference122 as decode}from'./generated/encoding-comparison/reference122.mjs'",
    "base122",
  ),
  build(
    "base122-fork",
    "import{Base122}from'./benchmarks/vendor/encoding-bench/code4fukui-Base122-Base122.js';export const decode=Base122.decode;",
    "base122",
  ),
  ...["high122", "block4", "blockStores", "groupUnroll"].map((n) =>
    build(
      "base122-" + n,
      `export{${n} as decode}from'./benchmarks/experiments/utf8-rival/base122.mjs'`,
      "base122",
    ),
  ),
];
sources.push(
  build(
    "utf8-sentinel-small",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/sentinel-small.mjs'",
    "utf8",
  ),
);
sources.push(
  build(
    "utf8-sentinel",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/sentinel.mjs'",
    "utf8",
  ),
);
sources.push(
  build(
    "utf8-sentinel-unroll",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/sentinel-unroll.mjs'",
    "utf8",
  ),
);
sources.push(
  build(
    "utf8-final-symbol",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/final-symbol.mjs'",
    "utf8",
  ),
);
sources.push(
  build(
    "utf8-pairs",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/pairs.mjs'",
    "utf8",
  ),
);
sources.push(
  build(
    "utf8-word16",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/word16.mjs'",
    "utf8",
  ),
);
sources.push(
  build(
    "utf8-branchless",
    "export{decode,warmup}from'./benchmarks/experiments/utf8-rival/branchless.mjs'",
    "utf8",
  ),
);
const selected = process.env.RIVAL_VARIANTS?.split(",");
if (process.env.RIVAL_EXTRA_MANIFEST) {
  for (const row of JSON.parse(
    fs.readFileSync(path.resolve(root, process.env.RIVAL_EXTRA_MANIFEST)),
  )) {
    const code = fs.readFileSync(path.resolve(root, row.file), "utf8");
    sources.push({ ...row, code, sha256: sha(code) });
  }
}
if (selected) {
  for (let i = sources.length - 1; i >= 0; i--)
    if (!selected.includes(sources[i].name)) sources.splice(i, 1);
  if (!sources.length) throw Error("No matching variants");
}
const manifest = require("../generated/utf8-rival/manifest.json"),
  fixtures = manifest.rows.map((r) => ({
    ...r,
    text: fs.readFileSync(path.join(root, r.file), "utf8"),
    base122Text: fs.readFileSync(path.join(root, r.base122), "utf8"),
    sha256: sha(fs.readFileSync(path.join(root, r.binary))),
  })),
  vectors = require("../generated/encoding-comparison/vectors.json");
(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.end("<!doctype html>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const records = [],
    checks = [];
  try {
    for (const executablePath of process.env.RIVAL_BROWSER === "current"
      ? ["/usr/bin/chromium"]
      : ["/usr/bin/chromium", path.join(root, ".tools/chromium109/chromium")])
      for (let run = 1; run <= runs; run++) {
        const ordered = sources.map(
            (_, i) => sources[(i + run - 1) % sources.length],
          ),
          browser = await chromium.launch({
            executablePath,
            headless: true,
            args: ["--no-sandbox"],
          });
        try {
          if (executablePath === "/usr/bin/chromium")
            assert.equal(
              browser.version(),
              require("./chromium.json").version,
              "Recorded Chromium version changed",
            );
          const p = await browser.newPage();
          await p.goto("http://127.0.0.1:" + server.address().port);
          const result = await p.evaluate(
            async ({ sources, fixtures, cases, vectors, rounds }) => {
              const modules = await Promise.all(
                  sources.map((s) => import(s.url)),
                ),
                hex = (b) =>
                  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join(
                    "",
                  );
              let checked = 0,
                sink = 0;
              for (let m = 0; m < modules.length; m++) {
                const list =
                  sources[m].family === "utf8"
                    ? cases
                    : vectors.map((v) => ({
                        text: v.base122,
                        hex: hex(
                          Uint8Array.from(atob(v.raw), (c) => c.charCodeAt(0)),
                        ),
                      }));
                for (const c of list) {
                  if (hex(modules[m].decode(c.text)) !== c.hex)
                    throw Error("Vector " + sources[m].name);
                  checked++;
                }
              }
              const jobs = [];
              for (let m = 0; m < modules.length; m++)
                for (let i = 0; i < fixtures.length; i++) {
                  const f = fixtures[i],
                    text =
                      sources[m].family === "utf8" ? f.text : f.base122Text,
                    bytes = modules[m].decode(text),
                    digest = await crypto.subtle.digest("SHA-256", bytes);
                  if (hex(new Uint8Array(digest)) !== f.sha256)
                    throw Error("Fixture " + sources[m].name);
                  if (
                    sources[m].family === "utf8" &&
                    (bytes.byteOffset ||
                      bytes.buffer.byteLength !== bytes.length)
                  )
                    throw Error("Ownership");
                  jobs.push({ m, i, text, samples: [] });
                }
              const measure = (j, n) => {
                const fn = modules[j.m].decode,
                  t = performance.now();
                for (let k = 0; k < n; k++) {
                  const bytes = fn(j.text);
                  sink = (sink + bytes.length + bytes[k % bytes.length]) | 0;
                }
                return (performance.now() - t) / n;
              };
              for (const j of jobs)
                measure(j, fixtures[j.i].bytes <= 1024 ? 200 : 16);
              for (let r = 0; r < rounds; r++)
                for (let n = 0; n < jobs.length; n++) {
                  const j = jobs[(n + r * 17) % jobs.length],
                    size = fixtures[j.i].bytes;
                  j.samples.push(
                    measure(j, size <= 1024 ? 1000 : size <= 65536 ? 20 : 2),
                  );
                }
              globalThis.sink = sink;
              return {
                checked,
                rows: jobs.map((j) => ({
                  m: j.m,
                  i: j.i,
                  samples: j.samples,
                  medianMs: [...j.samples].sort((a, b) => a - b)[
                    j.samples.length >> 1
                  ],
                })),
              };
            },
            {
              sources: ordered.map((s) => ({
                ...s,
                url: uri(s.code),
                code: undefined,
              })),
              fixtures,
              cases: manifest.cases,
              vectors,
              rounds,
            },
          );
          for (const r of result.rows)
            records.push({
              browser: browser.version(),
              run,
              variant: ordered[r.m].name,
              label: fixtures[r.i].label,
              inputBytes: fixtures[r.i].bytes,
              ...r,
              m: undefined,
              i: undefined,
            });
          checks.push({
            browser: browser.version(),
            run,
            checked: result.checked,
          });
          console.log(JSON.stringify(checks.at(-1)));
        } finally {
          await browser.close();
        }
      }
  } finally {
    await new Promise((r) => server.close(r));
  }
  fs.writeFileSync(
    path.join(dest, label + ".json"),
    JSON.stringify(
      {
        environment: {
          recordedAt: new Date().toISOString(),
          arch: process.arch,
          cpu: os.cpus()[0]?.model,
          runs,
          rounds,
          scope:
            "Complete warm decode; owned exact output for UTF-8, permissive view output allowed for Base122; no data integrity in either.",
          candidates: sources.map(({ code, ...s }) => s),
          inputs: fixtures.map(({ text, base122Text, ...r }) => ({
            ...r,
            base122Bytes: Buffer.byteLength(base122Text),
          })),
        },
        checks,
        records,
      },
      null,
      2,
    ) + "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
