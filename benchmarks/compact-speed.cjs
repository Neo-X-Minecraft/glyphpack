/* 0BSD, NeoX. Candidate screening; complete strings to owned decoded bytes. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { chromium } = require("playwright"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, ".."),
  vectors = require("../generated/compact-speed/vectors.json"),
  uri = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64"),
  source = esbuild.buildSync({
    entryPoints: [
      path.join(root, "benchmarks/experiments/compact-speed/decode.mjs"),
    ],
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    target: "chrome109",
  }).outputFiles[0].text,
  full = fs.readFileSync(path.join(root, "dist/full.min.mjs"), "utf8"),
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    let rows = [];
    for (const v of vectors) {
      const jobs = v.variants.map((j) => ({
        ...j,
        text: fs.readFileSync(j.file, "utf8"),
      }));
      jobs.push({ ...jobs.find((j) => j.name === "ans23"), name: "ans23-u32" });
      const r = await page.evaluate(
        async ({ code, full, jobs, size, expected }) => {
          const m = await import(code),
            f = await import(full);
          let sink = 0,
            rows = [];
          for (const j of jobs) {
            const run = () =>
              j.name.startsWith("ans")
                ? j.name.endsWith("u32")
                  ? m.ans32(j.text, j.state, size)
                  : m.ans(j.text, j.state, size, j.shift)
                : j.name === "prefix"
                  ? m.prefix(j.text, 0, size)
                  : f.binary(j.text, { verifyData: "none" });
            const out = run();
            let hash = 0;
            for (let i = 0; i < out.length; i++)
              hash = (Math.imul(hash, 31) + out[i]) | 0;
            if (hash !== expected)
              throw Error("bytes " + j.name + " " + hash + " / " + expected);
            const slow =
              j.name === "legacy" ||
              (j.name === "utf8-compact" && j.text.slice(2, 5) === "~c1");
            const warm = slow ? 0 : 12;
            for (let i = 0; i < warm; i++) {
              const b = run();
              sink ^= b[0];
            }
            const samples = [];
            for (let k = 0; k < (slow ? 1 : 7); k++) {
              const t = performance.now();
              const b = run();
              samples.push(performance.now() - t);
              sink ^= b[k % b.length];
            }
            rows.push({
              name: j.name,
              bytes: size,
              sourceBytes: j.sourceBytes,
              medianMs: samples.sort((a, b) => a - b)[samples.length >> 1],
              samples,
            });
          }
          globalThis.sink = sink;
          return rows;
        },
        {
          code: uri(source),
          full: uri(full),
          jobs,
          size: v.bytes,
          expected: Array.from(fs.readFileSync(v.input)).reduce(
            (h, b) => (Math.imul(h, 31) + b) | 0,
            0,
          ),
        },
      );
      rows.push(...r.map((r) => ({ ...r, input: v.name })));
      console.log(
        JSON.stringify({
          input: v.name,
          rows: r.map(({ samples, ...r }) => r),
        }),
      );
    }
    fs.mkdirSync(path.join(root, "benchmarks/results/compact-speed"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "benchmarks/results/compact-speed/screen.json"),
      JSON.stringify({ browser: browser.version(), rows }, null, 2) + "\n",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
