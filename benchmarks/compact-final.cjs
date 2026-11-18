/* 0BSD, NeoX. Current-format complete calls on recorded Chromium 156.
 * Public/synthetic inputs; owned bytes, selected integrity and all staging count. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  http = require("node:http"),
  os = require("node:os"),
  { execFileSync } = require("node:child_process"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  vectors = require("../generated/compact-speed/vectors.json"),
  dest = path.join(__dirname, "results/compact-speed"),
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  uri = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64"),
  runs = +(process.env.COMPACT_RUNS || 3),
  rounds = +(process.env.COMPACT_ROUNDS || 7);
const files = {
    current: "dist/full.min.mjs",
  },
  sources = Object.fromEntries(
    Object.entries(files).map(([k, f]) => {
      const b = fs.readFileSync(path.join(root, f));
      return [k, { file: f, bytes: b.length, sha256: sha(b), url: uri(b) }];
    }),
  );
(async () => {
  const jobs = [];
  for (const v of vectors) {
    const input = fs.readFileSync(v.input);
    for (const mode of ["none", "fast", "secure"]) {
      const text = execFileSync(
        path.join(root, "target/release/glyphpack"),
        [
          "encode",
          v.input,
          "--packing",
          "utf8-compact",
          "--checksum",
          mode,
          "--mask",
          "0",
        ],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
      jobs.push({
        input: v.name,
        size: v.bytes,
        mode,
        name: "compact-" + mode,
        module: "current",
        text,
        expected: sha(input),
      });
    }
    const fast = v.variants.find((r) => r.name === "utf8");
    jobs.push({
      input: v.name,
      size: v.bytes,
      mode: "none",
      name: "fast-utf8",
      module: "current",
      text: fs.readFileSync(fast.file, "utf8"),
      expected: sha(input),
    });
  }
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
        executablePath: process.env.CHROMIUM_BIN || "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox"],
      });
      try {
        if (browser.version() !== require("./chromium.json").version)
          throw Error("Recorded Chromium changed");
        const page = await browser.newPage();
        await page.goto("http://127.0.0.1:" + server.address().port);
        const data = await page.evaluate(
          async ({ sources, jobs, run, rounds }) => {
            const m = {};
            for (const [k, s] of Object.entries(sources)) {
              m[k] = await import(s.url);
              m[k].warmup(["utf8-compact"]);
            }
            let sink = 0;
            const rows = jobs.map((j) => ({
              ...j,
              samples: [],
              sourceBytes: new TextEncoder().encode(j.text).length,
              inner: j.text.slice(2, 5),
            }));
            const call = (j) => {
              const out = m[j.module].binary(j.text, {
                verifyFormat: true,
                verifyData: j.mode,
                memoryHeavy: false,
              });
              sink ^= out[0] || 0;
              return out;
            };
            for (const j of rows) {
              const b = call(j),
                digest = Array.from(
                  new Uint8Array(await crypto.subtle.digest("SHA-256", b)),
                  (v) => v.toString(16).padStart(2, "0"),
                ).join("");
              if (digest !== j.expected || b.length !== j.size)
                throw Error("Output " + j.name + " " + j.input);
              for (let n = 0; n < 8; n++) call(j);
            }
            for (let k = 0; k < rounds; k++)
              for (let i = 0; i < rows.length; i++) {
                const j = rows[(i + run * 3 + k * 7) % rows.length];
                const batch = j.size < 2048 ? 64 : 2,
                  t = performance.now();
                for (let n = 0; n < batch; n++) call(j);
                j.samples.push((performance.now() - t) / batch);
              }
            globalThis.sink = sink;
            return rows.map(({ text, expected, ...j }) => ({
              ...j,
              medianMs: [...j.samples].sort((a, b) => a - b)[
                j.samples.length >> 1
              ],
            }));
          },
          { sources, jobs, run, rounds },
        );
        records.push(...data.map((r) => ({ ...r, run })));
        console.log(
          JSON.stringify({
            run,
            browser: browser.version(),
            cases: data.length,
          }),
        );
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  const meta = {
    recordedAt: new Date().toISOString(),
    browser: require("./chromium.json").version,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    platform: process.platform,
    kernel: os.release(),
    runs,
    rounds,
    scope:
      `Resident string to fresh owned bytes. Includes requested integrity, staging, allocation, output copy; excludes encoding/import/warmup/SHA256. Rotated order, separate fresh processes. ${rounds} two-call samples (1KiB:64).`,
    sources: Object.fromEntries(
      Object.entries(sources).map(([k, { url, ...v }]) => [k, v]),
    ),
  };
  fs.writeFileSync(
    path.join(dest, "final.json"),
    JSON.stringify({ meta, records }, null, 2) + "\n",
  );
  const median = (a) => [...a].sort((a, b) => a - b)[a.length >> 1],
    rows = jobs.map((j) => {
      const r = records.filter((r) => r.input === j.input && r.name === j.name),
        x = r.map((r) => r.medianMs);
      return {
        input: j.input,
        decoder: j.name,
        mode: j.mode,
        inputBytes: j.size,
        sourceBytes: r[0].sourceBytes,
        inner: r[0].inner,
        medianMs: median(x),
        minMs: Math.min(...x),
        maxMs: Math.max(...x),
      };
    });
  fs.writeFileSync(
    path.join(dest, "summary.csv"),
    "input,decoder,integrity,input_bytes,payload_bytes,inner,median_ms,process_min_ms,process_max_ms\n" +
      rows
        .map((r) =>
          [
            r.input,
            r.decoder,
            r.mode,
            r.inputBytes,
            r.sourceBytes,
            r.inner,
            r.medianMs.toFixed(4),
            r.minMs.toFixed(4),
            r.maxMs.toFixed(4),
          ].join(","),
        )
        .join("\n") +
      "\n",
  );
  console.log(JSON.stringify(rows.filter((r) => r.input === "random-1MiB")));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
