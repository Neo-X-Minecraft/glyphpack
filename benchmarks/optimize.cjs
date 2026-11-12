/* 0BSD, NeoX. Matched production-module comparisons, including all input/output
 * copies and BLAKE3. Fixture loading, validation and imports are never timed.
 * Run multiple fresh processes before treating screening results as a win. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  crypto = require("node:crypto"),
  os = require("node:os"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/optimization");
const chosen = (
  process.env.OPT_VARIANTS || "baseline,default-baseline,compact-baseline"
).split(",");
const candidates = JSON.parse(
  fs.readFileSync(path.join(dir, "candidates.json")),
).rows.filter(
  (r) =>
    chosen.includes(r.variant) &&
    (!process.env.OPT_PROFILE || r.profile === process.env.OPT_PROFILE),
);
const allPolicies = process.env.OPT_ALL_POLICIES === "1";
const fixtures = JSON.parse(
  fs.readFileSync(path.join(root, "generated/codec-bench/manifest.json")),
).rows.filter((r) => allPolicies || r.integrity === "secure");
const runs = Number(process.env.OPT_RUNS || 1),
  rounds = Number(process.env.OPT_ROUNDS || 5),
  label = process.env.OPT_LABEL || "screen",
  smallBatch = Number(process.env.OPT_SMALL_BATCH || 1000);
if (!Number.isSafeInteger(smallBatch) || smallBatch < 1)
  throw Error("OPT_SMALL_BATCH must be a positive integer");
if (!candidates.length)
  throw Error("No matching candidates; prepare builds first");
const allowed = {
  recommended: ["pair"],
  "recommended-full": ["pair", "ans"],
  full: ["pair", "ans", "windows"],
};
(async () => {
  const server = http.createServer((req, res) => {
    // Improve clock resolution only; none of the measured code requires
    // isolation, shared memory or threads. Offline compatibility is separate.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    const m = /^\/(\d+)$/.exec(req.url);
    if (!m) {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html>");
      return;
    }
    fs.createReadStream(path.join(root, fixtures[+m[1]].file)).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const rows = [],
    warmups = [];
  try {
    for (const bin of [
      process.env.CHROMIUM_BIN || "/usr/bin/chromium",
      process.env.CHROMIUM109_BIN ||
        path.join(root, ".tools/chromium109/chromium"),
    ].filter((b, i) => i === 0 || fs.existsSync(b)))
      for (let run = 0; run < runs; run++) {
        const browser = await chromium.launch({
          headless: true,
          executablePath: bin,
          args: ["--no-sandbox"],
        });
        try {
          const page = await browser.newPage();
          await page.goto("http://127.0.0.1:" + server.address().port);
          await page.evaluate(
            async ({ modules, fixtures }) => {
              globalThis.modules = await Promise.all(
                modules.map((u) => import(u)),
              );
              globalThis.inputs = await Promise.all(
                fixtures.map(async (_, i) =>
                  new TextDecoder("utf-16le", {
                    fatal: true,
                    ignoreBOM: true,
                  }).decode(await (await fetch("/" + i)).arrayBuffer()),
                ),
              );
            },
            {
              modules: candidates.map(
                (c) =>
                  "data:text/javascript;base64," +
                  Buffer.from(
                    fs.readFileSync(path.join(root, c.module)),
                  ).toString("base64"),
              ),
              fixtures,
            },
          );
          const data = await page.evaluate(
            ({ meta, fixtures, allowed, rounds, allPolicies, smallBatch }) => {
              const jobs = [];
              let sink = 0;
              for (let m = 0; m < meta.length; m++) {
                modules[m].warmup(allowed[meta[m].profile]);
                for (let i = 0; i < fixtures.length; i++)
                  if (
                    allowed[meta[m].profile].includes(fixtures[i].packing) &&
                    (meta[m].profile === "full" ||
                      fixtures[i].integrity === "secure")
                  )
                    for (const verifyFormat of allPolicies &&
                    meta[m].profile === "full"
                      ? [false, true]
                      : [true])
                      for (const memoryHeavy of allPolicies &&
                      meta[m].profile === "full"
                        ? [false, true]
                        : [false])
                        jobs.push({
                          m,
                          i,
                          options: {
                            verifyData: fixtures[i].integrity,
                            verifyFormat,
                            memoryHeavy,
                          },
                          samples: [],
                        });
              }
              for (const j of jobs) {
                const out = modules[j.m].binary(inputs[j.i], j.options);
                if (out.length !== fixtures[j.i].bytes)
                  throw Error("Wrong size");
                let seed = 815;
                for (const byte of out) {
                  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                  if (byte !== seed >>> 24) throw Error("Wrong bytes");
                }
              }
              const measure = (j, count) => {
                const binary = modules[j.m].binary,
                  text = inputs[j.i],
                  options = j.options,
                  start = performance.now();
                for (let k = 0; k < count; k++) {
                  const out = binary(text, options);
                  sink = (sink + out.length + out[k % out.length]) >>> 0;
                }
                return (performance.now() - start) / count;
              };
              // Warm entry-point JS as well as Wasm loops. A few large calls
              // alone do not stabilize the JIT for short-string transfers.
              for (const j of jobs)
                measure(j, fixtures[j.i].bytes === 1024 ? 10000 : 4);
              for (let round = 0; round < rounds; round++)
                for (let n = 0; n < jobs.length; n++) {
                  const j = jobs[(n + round * 31) % jobs.length],
                    size = fixtures[j.i].bytes,
                    batch =
                      size <= 1024
                        ? smallBatch
                        : size <= 65536
                          ? 40
                          : size <= 1048576
                            ? 3
                            : 1;
                  j.samples.push(measure(j, batch));
                }
              globalThis.sink = sink;
              return jobs.map((j) => {
                const a = [...j.samples].sort((a, b) => a - b);
                return {
                  ...j,
                  medianMs: a[a.length >> 1],
                  minMs: a[0],
                  maxMs: a.at(-1),
                };
              });
            },
            {
              meta: candidates,
              fixtures,
              allowed,
              rounds,
              allPolicies,
              smallBatch,
            },
          );
          for (const { m, i, ...timing } of data)
            rows.push({
              browser: browser.version(),
              run: run + 1,
              profile: candidates[m].profile,
              variant: candidates[m].variant,
              moduleBytes: candidates[m].moduleBytes,
              packing: fixtures[i].packing,
              inputBytes: fixtures[i].bytes,
              ...timing,
            });
          if (
            process.env.OPT_WARMUP !== "0" &&
            candidates.every((c) => c.wasm)
          ) {
            const cold = await page.evaluate(
              async ({ sources, masks }) => {
                const compiled = await Promise.all(
                  sources.map((s) =>
                    WebAssembly.compile(
                      Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
                    ),
                  ),
                );
                const samples = compiled.map(() => []),
                  batch = 8;
                for (let round = -2; round < 9; round++)
                  for (let k = 0; k < compiled.length; k++) {
                    const i = (k + (round + 2) * 5) % compiled.length,
                      instances = await Promise.all(
                        Array.from(
                          { length: batch },
                          async () =>
                            (await WebAssembly.instantiate(compiled[i]))
                              .exports,
                        ),
                      );
                    const start = performance.now();
                    for (const api of instances)
                      if (api.warmup(masks[i], 0) !== 0)
                        throw Error("Warm-up failed");
                    const ms = (performance.now() - start) / batch;
                    if (round >= 0) samples[i].push(ms);
                  }
                return samples.map((a, i) => {
                  const sorted = [...a].sort((a, b) => a - b);
                  return {
                    i,
                    samples: a,
                    medianMs: sorted[4],
                    minMs: sorted[0],
                    maxMs: sorted[8],
                    batch,
                    isolated: crossOriginIsolated,
                  };
                });
              },
              {
                sources: candidates.map((c) =>
                  fs.readFileSync(path.join(root, c.wasm)).toString("base64"),
                ),
                masks: candidates.map(
                  (c) =>
                    ({ recommended: 1, "recommended-full": 3, full: 7 })[
                      c.profile
                    ],
                ),
              },
            );
            for (const { i, ...timing } of cold)
              warmups.push({
                browser: browser.version(),
                run: run + 1,
                profile: candidates[i].profile,
                variant: candidates[i].variant,
                ...timing,
              });
          }
          console.log(
            JSON.stringify({
              browser: browser.version(),
              run: run + 1,
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
  const environment = {
    recordedAt: new Date().toISOString(),
    arch: process.arch,
    platform: process.platform,
    cpu: os.cpus()[0].model,
    runs,
    rounds,
    batches: { small: smallBatch, kib64: 40, mib1: 3, mib10: 1 },
    warmups: { smallInputCalls: 10000, otherInputCalls: 4 },
    integrity: allPolicies ? "none/XXH32/BLAKE3" : "BLAKE3",
    format: allPolicies ? "both" : true,
    memoryHeavy: allPolicies ? "both" : false,
    scope:
      "warm binary(): resident string to owned output, including input copy/decoding/selected verification/output copy; fixed batches, rotated order",
    isolation:
      "COOP/COEP improve timing resolution; no shared memory/threads used",
    candidates: candidates.map((c) => ({
      ...c,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, c.module)))
        .digest("hex"),
    })),
  };
  fs.writeFileSync(
    path.join(dir, label + ".json"),
    JSON.stringify({ environment, rows, warmups }, null, 2) + "\n",
  );
  const cols = [
    "browser",
    "run",
    "profile",
    "variant",
    "packing",
    "inputBytes",
    "moduleBytes",
    "verifyData",
    "verifyFormat",
    "memoryHeavy",
    "medianMs",
    "minMs",
    "maxMs",
    ...Array.from({ length: rounds }, (_, i) => "sample" + (i + 1)),
  ];
  fs.writeFileSync(
    path.join(dir, label + ".csv"),
    cols.join(",") +
      "\n" +
      rows
        .map((r) => {
          const row = {
            ...r,
            ...r.options,
            ...Object.fromEntries(
              r.samples.map((s, i) => ["sample" + (i + 1), s]),
            ),
          };
          return cols.map((k) => row[k]).join(",");
        })
        .join("\n") +
      "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
