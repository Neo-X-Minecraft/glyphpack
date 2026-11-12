/* 0BSD, NeoX. Prefix transport screen: actual Chromium, identical raw inputs,
 * complete owned outputs and all structural checks. Loading is outside timers. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  http = require("node:http"),
  os = require("node:os"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright"),
  esbuild = require("esbuild"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  work = path.join(root, "generated/utf8-prefix"),
  out = path.join(root, "benchmarks/results/utf8-prefix");
fs.mkdirSync(out, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(work, "manifest.json"))),
  inputs = JSON.parse(
    fs.readFileSync(
      path.join(root, "generated/encoding-comparison/inputs.json"),
    ),
  ),
  rows = manifest.rows.filter((r) => r.label.startsWith("random-")),
  runs = Number(process.env.PREFIX_RUNS || 3),
  rounds = Number(process.env.PREFIX_ROUNDS || 9),
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  uri = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64");
const sources = [
  "prefix",
  "prefix-fast",
  "prefix-branch",
  "prefix-split",
  "prefix-deferred",
  "prefix-block-validated",
].map((name) => ({
  name,
  source: esbuild.buildSync({
    entryPoints: [
      path.join(root, "benchmarks/experiments/utf8/" + name + ".mjs"),
    ],
    bundle: true,
    write: false,
    format: "esm",
    target: "chrome109",
    minify: true,
  }).outputFiles[0].text,
}));
const kernel = fs.readFileSync(path.join(work, "kernel.wasm"));
sources.push({
  name: "portable-delivered",
  source: fs.readFileSync(path.join(work, "decoder.min.mjs"), "utf8"),
});
sources.push({
  name: "balanced-delivered",
  source: fs.readFileSync(path.join(work, "decoder-balanced.min.mjs"), "utf8"),
});
sources.push({
  name: "wasm",
  source: `const raw=Uint8Array.from(atob(${JSON.stringify(kernel.toString("base64"))}),c=>c.charCodeAt(0)),apis=await Promise.all(Array.from({length:6},async()=> (await WebAssembly.instantiate(raw)).instance.exports));export function binary(t){const api=apis[t.charCodeAt(3)-65],p=api.reserve(t.length);if(!p)throw Error('Reserve failed');const view=new Uint16Array(api.memory.buffer,p,t.length);for(let i=0;i<t.length;i++)view[i]=t.charCodeAt(i);const status=api.decode();if(status)throw Error('Status '+status);return new Uint8Array(api.memory.buffer,api.output_ptr(),api.output_len()).slice();}`,
});
const peers = fs.readFileSync(
  path.join(root, "generated/encoding-comparison/competitors.mjs"),
  "utf8",
);
const fixtures = rows.map((r) => ({
  ...r,
  text: fs.readFileSync(path.join(root, r.file), "utf8"),
  sha256: sha(fs.readFileSync(path.join(root, r.binary))),
}));
const peerInputs = inputs
  .filter((r) => r.label.startsWith("random-"))
  .map((r) => ({
    ...r,
    base122: fs.readFileSync(path.join(root, r.texts.none.base122), "utf8"),
    base64: fs.readFileSync(path.join(root, r.texts.none.base64), "utf8"),
    sha256: sha(fs.readFileSync(path.join(root, r.binary))),
  }));
(async () => {
  const arithmetic = await import(
    pathToFileURL(
      path.join(root, "benchmarks/experiments/utf8/reference/arithmetic.mjs"),
    )
  );
  const arithmeticSource = fs.readFileSync(
    path.join(root, "benchmarks/experiments/utf8/dense-browser.mjs"),
    "utf8",
  );
  for (const row of peerInputs)
    row.arithmetic = arithmetic
      .arithmeticEncode(fs.readFileSync(path.join(root, row.binary)))
      .replace(/\0/g, "\ufffd");
  const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.end("<!doctype html>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const measurements = [],
    compatibility = [];
  try {
    for (const bin of [
      process.env.CHROMIUM_BIN || "/usr/bin/chromium",
      process.env.CHROMIUM109_BIN ||
        path.join(root, ".tools/chromium109/chromium"),
    ].filter((f, i) => i === 0 || fs.existsSync(f))) {
      for (let run = 1; run <= runs; run++) {
        const browser = await chromium.launch({
          executablePath: bin,
          headless: true,
          args: ["--no-sandbox"],
        });
        try {
          const page = await browser.newPage();
          await page.goto("http://127.0.0.1:" + server.address().port);
          const result = await page.evaluate(
            async ({
              sources,
              peers,
              fixtures,
              peerInputs,
              cases,
              rounds,
              arithmeticUrl,
              compare,
            }) => {
              const modules = await Promise.all(
                  sources.map((s) => import(s.url)),
                ),
                p = await import(peers);
              const arithmetic = await import(arithmeticUrl);
              let sink = 0;
              let checked = 0;
              for (const [index, m] of modules.entries())
                for (const c of cases) {
                  if (
                    sources[index].name.endsWith("-delivered") &&
                    c.text[3] !== "F"
                  )
                    continue;
                  const bytes = (m.binary || m.decode)(c.text);
                  if (
                    Array.from(bytes, (b) =>
                      b.toString(16).padStart(2, "0"),
                    ).join("") !== c.hex
                  )
                    throw Error("Compatibility");
                  checked++;
                }
              let jobs = [];
              for (let m = 0; m < modules.length; m++)
                for (let i = 0; i < fixtures.length; i++)
                  if (
                    !sources[m].name.endsWith("-delivered") ||
                    fixtures[i].profile === 5
                  )
                    jobs.push({
                      name: sources[m].name,
                      fixture: i,
                      fn: modules[m].binary || modules[m].decode,
                      text: fixtures[i].text,
                      bytes: fixtures[i].inputBytes,
                      profile: fixtures[i].profile,
                      samples: [],
                    });
              const functions = [
                ["base122-inline", p.local.inline122],
                ["base122-block", p.local.block122],
                ["base122-counted", p.local.counted122],
                ["base122-fork", p.fork.decode],
                ["base122-reference", p.reference122],
                ["base64-atob", p.local.nativeAtob],
              ];
              if (Uint8Array.fromBase64)
                functions.push([
                  "base64-native",
                  (s) => Uint8Array.fromBase64(s),
                ]);
              for (let i = 0; i < peerInputs.length; i++)
                for (const [name, fn] of functions)
                  jobs.push({
                    name,
                    fixture: i,
                    fn,
                    text: peerInputs[i][
                      name.startsWith("base122") ? "base122" : "base64"
                    ],
                    bytes: peerInputs[i].bytes,
                    profile: -1,
                    samples: [],
                  });
              for (let i = 0; i < peerInputs.length; i++)
                jobs.push({
                  name: "arithmetic",
                  fixture: i,
                  fn: (s) =>
                    arithmetic.decodeDenseBrowser(s, peerInputs[i].bytes),
                  text: peerInputs[i].arithmetic,
                  bytes: peerInputs[i].bytes,
                  profile: -1,
                  samples: [],
                });
              if (compare)
                jobs = jobs.filter(
                  (j) =>
                    j.name === "portable-delivered" ||
                    j.name === "balanced-delivered" ||
                    j.name === "arithmetic" ||
                    j.name.startsWith("base122-") ||
                    j.name.startsWith("base64-") ||
                    (j.name === "prefix-split" && j.profile === 4) ||
                    (j.name === "prefix-deferred" && j.profile === 5),
                );
              for (const j of jobs) {
                const bytes = j.fn(j.text),
                  hash = await crypto.subtle.digest("SHA-256", bytes),
                  actual = Array.from(new Uint8Array(hash), (b) =>
                    b.toString(16).padStart(2, "0"),
                  ).join("");
                if (
                  bytes.length !== j.bytes ||
                  actual !==
                    (j.profile < 0
                      ? peerInputs[j.fixture].sha256
                      : fixtures[j.fixture].sha256)
                )
                  throw Error("Wrong output " + j.name);
              }
              const measure = (j, count) => {
                const start = performance.now();
                for (let k = 0; k < count; k++) {
                  const bytes = j.fn(j.text);
                  sink = (sink + bytes.length + bytes[k % bytes.length]) | 0;
                }
                return (performance.now() - start) / count;
              };
              for (const j of jobs) measure(j, j.bytes <= 1024 ? 100 : 4);
              for (let r = 0; r < rounds; r++)
                for (let n = 0; n < jobs.length; n++) {
                  const j = jobs[(n + r * 17) % jobs.length];
                  j.samples.push(
                    measure(
                      j,
                      j.bytes <= 1024 ? 500 : j.bytes <= 65536 ? 10 : 1,
                    ),
                  );
                }
              globalThis.sink = sink;
              return {
                checked,
                rows: jobs.map((j) => ({
                  name: j.name,
                  profile: j.profile,
                  inputBytes: j.bytes,
                  samples: j.samples,
                  medianMs: [...j.samples].sort((a, b) => a - b)[
                    j.samples.length >> 1
                  ],
                })),
              };
            },
            {
              sources: sources.map((s) => ({
                name: s.name,
                url: uri(s.source),
              })),
              peers: uri(peers),
              fixtures,
              peerInputs,
              cases: run === 1 ? manifest.cases : [],
              rounds,
              arithmeticUrl: uri(arithmeticSource),
              compare: process.env.PREFIX_COMPARE === "1",
            },
          );
          measurements.push(
            ...result.rows.map((r) => ({
              browser: browser.version(),
              run,
              ...r,
            })),
          );
          console.log(
            JSON.stringify({
              browser: browser.version(),
              run,
              cases: result.rows.length,
              checked: result.checked,
            }),
          );
        } finally {
          await browser.close();
        }
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  const environment = {
    recordedAt: new Date().toISOString(),
    runs,
    rounds,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    scope:
      "resident source string to fresh decoded bytes, including format checks and all Wasm transfers; no hashing",
    variants: sources.map((s) => ({
      name: s.name,
      bytes: Buffer.byteLength(s.source),
      sha256: sha(s.source),
    })),
    kernelSha256: sha(kernel),
    arithmeticSha256: sha(arithmeticSource),
    methodology:
      "Three fresh processes per browser, warm entry points, nine rotated batches. Byte hashes checked outside timers; comparisons include all input/output copies. Structural checks differ between codecs; no data integrity verification.",
  };
  fs.writeFileSync(
    path.join(out, (process.env.PREFIX_LABEL || "screen") + ".json"),
    JSON.stringify({ environment, measurements }, null, 2) + "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
