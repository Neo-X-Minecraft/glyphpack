/* 0BSD, NeoX. Controlled wire-compatible decoder search. Native preparation is
 * separate, valid results and exact errors are checked before warm timing. */
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  crypto = require("node:crypto"),
  { execFileSync } = require("node:child_process"),
  os = require("node:os"),
  { chromium } = require("playwright"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/utf8-speed"),
  out = path.resolve(
    root,
    process.env.SPEED_OUT || "benchmarks/results/utf8-speed",
  );
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const chosen = (
    process.env.SPEED_VARIANTS ||
    "before,speculative,wordStores,splitTables,sentinel,stateTable,wideStateTable,byteInput"
  ).split(","),
  runs = Number(process.env.SPEED_RUNS || 1),
  rounds = Number(process.env.SPEED_ROUNDS || 5),
  label = process.env.SPEED_LABEL || "screen",
  checking = process.env.SPEED_CHECK_ONLY === "1",
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  uri = (b) =>
    "data:text/javascript;base64," + Buffer.from(b).toString("base64");
const candidates = chosen.map((name) => {
  let code;
  if (name === "before")
    code = fs.readFileSync(path.join(dir, "before.mjs"), "utf8");
  else if (fs.existsSync(path.join(dir, name + ".custom.mjs")))
    code = fs.readFileSync(path.join(dir, name + ".custom.mjs"), "utf8");
  else
    code = esbuild.buildSync({
      stdin: {
        contents: `export {${name} as decode} from './benchmarks/experiments/utf8/speed/candidates.mjs';export {warmup} from './benchmarks/experiments/utf8/speed/model-wide.mjs';`,
        resolveDir: root,
        loader: "js",
      },
      bundle: true,
      write: false,
      format: "esm",
      minify: true,
      target: "chrome109",
      define: { PREFIX_PORTABLE_ONLY: "true" },
    }).outputFiles[0].text;
  fs.writeFileSync(path.join(dir, name + ".mjs"), code);
  return { name, code, bytes: Buffer.byteLength(code), sha256: sha(code) };
});
const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "generated/utf8-prefix/manifest.json")),
  ),
  fixtures = manifest.rows
    .filter(
      (r) =>
        r.profile === 5 &&
        (r.label.startsWith("random-") ||
          r.label === "zeros-1MiB" ||
          r.label === "sequential-1MiB"),
    )
    .map((r) => ({
      ...r,
      text: fs.readFileSync(path.join(root, r.file), "utf8"),
      sha256: sha(fs.readFileSync(path.join(root, r.binary))),
    })),
  cases = manifest.cases.filter((c) => c.text[3] === "F");
(async () => {
  // Malformed probes can poison feedback and trigger deoptimization. Correctness
  // and performance therefore run in different browser processes, not merely
  // different module URLs. Every timed process sees valid inputs only.
  if (!checking && process.env.SPEED_SKIP_CHECKS !== "1")
    execFileSync(process.execPath, [__filename], {
      stdio: "inherit",
      env: {
        ...process.env,
        SPEED_CHECK_ONLY: "1",
        SPEED_RUNS: "1",
        SPEED_LABEL: label + "-checks",
      },
    });
  const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.end("<!doctype html>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const rows = [],
    cold = [],
    verification = [];
  try {
    for (const bin of [
      process.env.CHROMIUM_BIN || "/usr/bin/chromium",
      process.env.CHROMIUM109_BIN ||
        path.join(root, ".tools/chromium109/chromium"),
    ].filter((p, i) => i === 0 || fs.existsSync(p)))
      for (let run = 1; run <= runs; run++) {
        const ordered = candidates.map(
          (_, i) => candidates[(i + run - 1) % candidates.length],
        );
        const browser = await chromium.launch({
          executablePath: bin,
          headless: true,
          args: [
            "--no-sandbox",
            ...JSON.parse(process.env.SPEED_BROWSER_ARGS || "[]"),
          ],
        });
        try {
          const page = await browser.newPage();
          await page.goto("http://127.0.0.1:" + server.address().port);
          const result = await page.evaluate(
            async ({
              sources,
              fixtures,
              cases,
              rounds,
              checking,
              referenceIndex,
              allowFallback,
            }) => {
              const modules = [],
                imports = [];
              for (const source of sources) {
                const t = performance.now();
                modules.push(await import(source));
                imports.push(performance.now() - t);
              }
              const cold = [],
                jobs = [];
              let checked = 0,
                mutated = 0;
              const hex = (bytes) =>
                Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
                  "",
                );
              const reference = modules[referenceIndex].decode;
              for (const m of modules)
                if (
                  !allowFallback &&
                  m.backend !== undefined &&
                  m.backend !== "wasm"
                )
                  throw Error(
                    "Hybrid silently fell back to JS during benchmark",
                  );
              for (let m = 0; m < modules.length; m++) {
                const t = performance.now(),
                  first = modules[m].decode(fixtures[0].text);
                cold.push({
                  m,
                  ms: performance.now() - t,
                  importMs: imports[m],
                });
                if (first.length !== fixtures[0].inputBytes)
                  throw Error("Cold output");
                for (const c of checking ? cases : []) {
                  const bytes = modules[m].decode(c.text);
                  if (
                    hex(bytes) !== c.hex ||
                    bytes.byteOffset ||
                    bytes.buffer.byteLength !== bytes.length
                  )
                    throw Error("Output mismatch " + m);
                  checked++;
                }
              }
              // Bounded mutations: headers cannot request more than the supplied body
              // capacity; random characters include surrogates and noncanonical tails.
              let seed = 815;
              const next = () => {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return seed;
              };
              const outcome = (fn, t) => {
                try {
                  return ["ok", hex(fn(t))];
                } catch (e) {
                  return ["err", e.message];
                }
              };
              const mutations = [];
              for (let k = 0; k < (checking ? 600 : 0); k++) {
                const c = cases[next() % cases.length],
                  t = c.text,
                  pos = next() % t.length;
                mutations.push(
                  t.slice(0, pos) +
                    String.fromCharCode(next() & 65535) +
                    t.slice(pos + 1),
                );
                if (k % 3 === 0) mutations.push(t.slice(0, -1), t + "A");
              }
              for (const t of mutations) {
                const expected = outcome(reference, t);
                for (let m = 0; m < modules.length; m++) {
                  if (m === referenceIndex) continue;
                  const got = outcome(modules[m].decode, t);
                  if (got[0] !== expected[0] || got[1] !== expected[1])
                    throw Error(
                      "Error/output difference " +
                        m +
                        " " +
                        JSON.stringify({
                          expected,
                          got,
                          header: t.slice(0, 10),
                        }),
                    );
                  mutated++;
                }
              }
              if (checking)
                return {
                  cold,
                  checked,
                  mutated,
                  rows: [],
                  backends: modules.map((m) => m.backend || "js"),
                };
              for (let m = 0; m < modules.length; m++)
                for (let i = 0; i < fixtures.length; i++) {
                  const bytes = modules[m].decode(fixtures[i].text),
                    digest = await crypto.subtle.digest("SHA-256", bytes);
                  if (hex(new Uint8Array(digest)) !== fixtures[i].sha256)
                    throw Error("Fixture mismatch " + m);
                  jobs.push({ m, i, samples: [] });
                }
              let sink = 0;
              const measure = (j, count) => {
                const fn = modules[j.m].decode,
                  text = fixtures[j.i].text,
                  start = performance.now();
                for (let k = 0; k < count; k++) {
                  const bytes = fn(text);
                  sink = (sink + bytes.length + bytes[k % bytes.length]) | 0;
                }
                return (performance.now() - start) / count;
              };
              for (const j of jobs)
                measure(j, fixtures[j.i].inputBytes <= 1024 ? 200 : 32);
              for (let r = 0; r < rounds; r++)
                for (let n = 0; n < jobs.length; n++) {
                  const j = jobs[(n + r * 17) % jobs.length],
                    size = fixtures[j.i].inputBytes;
                  j.samples.push(
                    measure(j, size <= 1024 ? 1000 : size <= 65536 ? 20 : 2),
                  );
                }
              globalThis.sink = sink;
              return {
                cold,
                backends: modules.map((m) => m.backend || "js"),
                checked,
                mutated,
                rows: jobs.map((j) => ({
                  ...j,
                  medianMs: [...j.samples].sort((a, b) => a - b)[
                    j.samples.length >> 1
                  ],
                })),
              };
            },
            {
              sources: ordered.map((c) => uri(c.code)),
              referenceIndex: Math.max(
                0,
                ordered.findIndex((c) => c.name === "before"),
              ),
              fixtures,
              cases,
              rounds,
              checking,
              allowFallback: process.env.SPEED_ALLOW_FALLBACK === "1",
            },
          );
          for (const r of result.rows)
            rows.push({
              browser: browser.version(),
              run,
              variant: ordered[r.m].name,
              label: fixtures[r.i].label,
              inputBytes: fixtures[r.i].inputBytes,
              medianMs: r.medianMs,
              samples: r.samples,
            });
          for (const r of result.cold)
            cold.push({
              browser: browser.version(),
              run,
              variant: ordered[r.m].name,
              firstDecodeMs: r.ms,
              importMs: r.importMs,
            });
          verification.push({
            browser: browser.version(),
            run,
            positive: result.checked,
            mutations: result.mutated,
            backends: result.backends,
          });
          console.log(JSON.stringify(verification.at(-1)));
        } finally {
          await browser.close();
        }
      }
  } finally {
    await new Promise((r) => server.close(r));
  }
  const environment = {
    browserArgs: JSON.parse(process.env.SPEED_BROWSER_ARGS || "[]"),
    recordedAt: new Date().toISOString(),
    runs,
    rounds,
    checking,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    scope:
      "Resident string to fresh exact-size bytes; format checks and all conversions included. No integrity verification.",
    order:
      "Rotated fixed batches; fresh process per run; malformed-input checks use separate processes. Import precedes cold first decode and warm-up.",
    candidates: candidates.map(({ code, ...c }) => c),
    inputs: fixtures.map(({ text, ...r }) => r),
  };
  fs.writeFileSync(
    path.join(out, label + ".json"),
    JSON.stringify({ environment, rows, cold, verification }, null, 2) + "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
