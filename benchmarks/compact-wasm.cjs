/* 0BSD, NeoX. End-to-end native ANS candidates, including staging/copying. */
const fs = require("node:fs"),
  path = require("node:path"),
  { chromium } = require("playwright"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, ".."),
  uri = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64"),
  vectors = require("../generated/compact-speed/vectors.json"),
  source = esbuild.buildSync({
    stdin: {
      contents:
        "export{host}from './benchmarks/experiments/compact-speed/host.mjs';export{ans,ans32}from './benchmarks/experiments/compact-speed/decode.mjs';",
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: "esm",
    minify: true,
  }).outputFiles[0].text;
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
    headless: true,
  });
  try {
    const page = await browser.newPage(),
      rows = [];
    for (const v of vectors.filter((v) => v.name.includes("1MiB"))) {
      const jobs = [];
      for (const bits of [23, 30]) {
        const j = v.variants.find((j) => j.name === "ans" + bits);
        for (const copy of [0, 1])
          for (const float of bits === 30
            ? ["", "_float", "_const", "_u32"]
            : [""])
            jobs.push({
              ...j,
              text: fs.readFileSync(j.file, "utf8"),
              copy,
              kernel: "decode_" + bits + float,
              name: "wasm" + bits + float + "-copy" + copy,
            });
      }
      const got = await page.evaluate(
        async ({ code, wasm, jobs, size, expected }) => {
          const m = await import(code),
            rows = [];
          let sink = 0;
          for (const j of jobs) {
            const run = m.host(Uint8Array.from(wasm), j.kernel, j.copy),
              b = run(j.text, j.state, size);
            let h = 0;
            for (const x of b) h = (Math.imul(h, 31) + x) | 0;
            if (h !== expected) throw Error("bytes " + j.name);
            for (let i = 0; i < 16; i++) sink ^= run(j.text, j.state, size)[0];
            const samples = [];
            for (let i = 0; i < 9; i++) {
              const t = performance.now();
              const b = run(j.text, j.state, size);
              samples.push(performance.now() - t);
              sink ^= b[i];
            }
            rows.push({
              name: j.name,
              sourceBytes: j.sourceBytes,
              medianMs: [...samples].sort((a, b) => a - b)[4],
              samples,
            });
          }
          globalThis.sink = sink;
          return rows;
        },
        {
          code: uri(source),
          wasm: Array.from(
            fs.readFileSync(
              path.join(root, "generated/compact-speed/decoder.wasm"),
            ),
          ),
          jobs,
          size: v.bytes,
          expected: Array.from(fs.readFileSync(v.input)).reduce(
            (h, b) => (Math.imul(h, 31) + b) | 0,
            0,
          ),
        },
      );
      rows.push(...got.map((r) => ({ ...r, input: v.name })));
      console.log(
        JSON.stringify({
          input: v.name,
          rows: got.map(({ samples, ...r }) => r),
        }),
      );
    }
    fs.writeFileSync(
      path.join(root, "benchmarks/results/compact-speed/wasm.json"),
      JSON.stringify({ browser: browser.version(), rows }, null, 2) + "\n",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
