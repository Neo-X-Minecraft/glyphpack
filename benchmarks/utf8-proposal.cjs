/* 0BSD, NeoX. Research only: actual UTF-8 file navigation and matched resident
 * decode timings for the supplied arithmetic prototype. No production changes.
 * Prepare public peer fixtures first: glyphpack bench prepare. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  os = require("node:os"),
  http = require("node:http"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright"),
  esbuild = require("esbuild"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  work = path.join(root, "generated/utf8-evaluation"),
  output = path.join(root, "benchmarks/results/utf8-proposal"),
  experiment = path.join(root, "benchmarks/experiments/utf8"),
  runs = Number(process.env.UTF8_RUNS || 3),
  rounds = Number(process.env.UTF8_ROUNDS || 5),
  sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex"),
  uri = (source) =>
    "data:text/javascript;base64," + Buffer.from(source).toString("base64"),
  minify = (source) =>
    esbuild
      .transformSync(source, { minify: true, target: "chrome109" })
      .code.trim();
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(output, { recursive: true });
(async () => {
  const reference = await import(
      pathToFileURL(path.join(experiment, "reference/arithmetic.mjs"))
    ),
    { modelFor, protect } = await import(
      pathToFileURL(path.join(experiment, "reference/codec.mjs"))
    ),
    { decodeDenseBrowser } = await import(
      pathToFileURL(path.join(experiment, "dense-browser.mjs"))
    );
  // Native Rust peer preparation provides identical binary/Base64/Base122 data.
  const inputs = JSON.parse(
    fs.readFileSync(
      path.join(root, "generated/encoding-comparison/inputs.json"),
    ),
  ).filter((r) =>
    ["random-1KiB", "random-64KiB", "random-1MiB"].includes(r.label),
  );
  assert.equal(inputs.length, 3, "Run glyphpack bench prepare first");
  const standalone = (fn) => minify("globalThis.decoder=" + fn.toString());
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(experiment, "reference/arithmetic.mjs")],
    bundle: true,
    write: false,
    format: "esm",
    target: "chrome109",
    minify: true,
  }).outputFiles[0].text;
  const peerSource = fs.readFileSync(
    path.join(root, "generated/encoding-comparison/competitors.mjs"),
    "utf8",
  );
  const fastSource = fs.readFileSync(
      path.join(experiment, "dense-browser.mjs"),
      "utf8",
    ),
    glyphSource = fs.readFileSync(path.join(root, "dist/none.min.mjs"), "utf8");
  const fixtures = [],
    pages = [],
    sizes = [];
  for (const row of inputs) {
    const data = fs.readFileSync(path.join(root, row.binary)),
      texts = {},
      expected = sha(data);
    for (const mode of ["base64", "base122"])
      texts[mode] = fs.readFileSync(
        path.join(root, row.texts.none[mode]),
        "utf8",
      );
    texts.pair = fs
      .readFileSync(path.join(root, row.texts.none.bmp))
      .toString("utf16le");
    for (const profile of ["utf8-data", "utf8-clean", "utf8-template"]) {
      const encoded = reference.arithmeticEncode(data, { profile });
      texts[profile] = encoded;
      assert.deepEqual(
        Buffer.from(
          reference.decodeArithmetic(encoded, data.length, { profile }),
        ),
        data,
      );
      const decoderCode = standalone(reference.arithmeticDecode),
        decoder = decoderCode
          .slice("globalThis.decoder=".length)
          .replace(/;$/, "");
      const full = reference.makeArithmeticHTML(data, {
        profile,
        payload: encoded,
        decoder,
      }).html;
      const variants = [
        {
          name: profile,
          html: full,
          decoderBytes: Buffer.byteLength(decoderCode),
        },
      ];
      if (profile === "utf8-data") {
        assert.deepEqual(
          Buffer.from(decodeDenseBrowser(encoded, data.length)),
          data,
        );
        variants.push({
          name: "utf8-fast-experiment",
          html:
            "<meta charset=utf-8><script type=x id=p>" +
            encoded +
            "</script><script>" +
            standalone(decodeDenseBrowser) +
            ';globalThis.unpacked=decoder(document.getElementById("p").textContent,' +
            data.length +
            ")</script>",
          decoderBytes: Buffer.byteLength(standalone(decodeDenseBrowser)),
        });
      }
      for (const v of variants) {
        const file = path.join(work, row.label + "-" + v.name + ".html");
        fs.writeFileSync(file, v.html);
        pages.push({
          label: row.label,
          variant: v.name,
          file,
          bytes: data.length,
          sha256: expected,
        });
        sizes.push({
          label: row.label,
          variant: v.name,
          inputBytes: data.length,
          payloadBytes: Buffer.byteLength(encoded),
          jsonStringBytes: Buffer.byteLength(JSON.stringify(encoded)),
          htmlBytes: Buffer.byteLength(v.html),
          standaloneCodeBytes: v.decoderBytes,
        });
      }
    }
    for (const mode of ["base64", "base122"])
      sizes.push({
        label: row.label,
        variant: mode,
        inputBytes: data.length,
        payloadBytes: Buffer.byteLength(texts[mode]),
        jsonStringBytes: Buffer.byteLength(JSON.stringify(texts[mode])),
      });
    fixtures.push({
      label: row.label,
      bytes: data.length,
      sha256: expected,
      texts,
    });
  }
  // UTF-8 byte files, not setContent(): catches charset/BOM/tokenization issues.
  const compatibility = [],
    measurements = [];
  const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    const page = pages.find((p) => "/" + path.basename(p.file) === req.url);
    if (page) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(fs.readFileSync(page.file));
    } else res.end("<!doctype html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const executablePath of [
      process.env.CHROMIUM_BIN || "/usr/bin/chromium",
      process.env.CHROMIUM109_BIN ||
        path.join(root, ".tools/chromium109/chromium"),
    ].filter((bin, i) => i === 0 || fs.existsSync(bin))) {
      for (let run = 1; run <= runs; run++) {
        const browser = await chromium.launch({
          executablePath,
          headless: true,
          args: ["--no-sandbox"],
        });
        try {
          if (run === 1)
            for (const protocol of ["file", "http"]) {
              const context = await browser.newContext();
              if (protocol === "file") await context.setOffline(true);
              await context.addInitScript(() => {
                globalThis.WebAssembly = undefined;
                globalThis.DecompressionStream = undefined;
                globalThis.fetch = () => {
                  throw Error("Unexpected runtime fetch");
                };
              });
              const page = await context.newPage();
              const requests = [];
              page.on("request", (r) => {
                if (/^https?:/.test(r.url())) requests.push(r.url());
              });
              for (const p of pages) {
                const errors = [];
                const onError = (e) => errors.push(e.message);
                page.on("pageerror", onError);
                await page.goto(
                  protocol === "file"
                    ? pathToFileURL(p.file).href
                    : "http://127.0.0.1:" +
                        server.address().port +
                        "/" +
                        path.basename(p.file),
                );
                page.off("pageerror", onError);
                assert.deepEqual(errors, []);
                const actual = await page.evaluate(async () => {
                  const bytes = globalThis.unpacked;
                  if (!(bytes instanceof Uint8Array))
                    throw Error("Missing output");
                  const hash = await crypto.subtle.digest("SHA-256", bytes);
                  return {
                    bytes: bytes.length,
                    sha256: Array.from(new Uint8Array(hash), (b) =>
                      b.toString(16).padStart(2, "0"),
                    ).join(""),
                    charset: document.characterSet,
                  };
                });
                assert.equal(actual.bytes, p.bytes);
                assert.equal(actual.sha256, p.sha256);
                assert.equal(actual.charset, "UTF-8");
              }
              assert.equal(
                requests.length,
                protocol === "file" ? 0 : pages.length,
              );
              compatibility.push({
                browser: browser.version(),
                protocol,
                pages: pages.length,
                wasmAvailable: false,
                decompressionStreamAvailable: false,
                runtimeFetch: false,
                passed: true,
              });
              await context.close();
            }
          const page = await browser.newPage();
          await page.goto("http://127.0.0.1:" + server.address().port);
          const timing = await page.evaluate(
            async ({ sources, fixtures, rounds }) => {
              const [reference, peers, fast, glyph] = await Promise.all(
                sources.map((s) => import(s)),
              );
              const alphabet = Array.from({ length: 128 }, (_, c) => c).filter(
                  (c) => c !== 13,
                ),
                cdf = [0, 926774, 1024282, 1045997, 1048576];
              const jobs = [];
              for (let i = 0; i < fixtures.length; i++) {
                const f = fixtures[i],
                  add = (variant, text, fn) =>
                    jobs.push({ i, variant, text, fn, samples: [] });
                add("base64-atob", f.texts.base64, peers.local.nativeAtob);
                if (Uint8Array.fromBase64)
                  add("base64-native", f.texts.base64, (s) =>
                    Uint8Array.fromBase64(s),
                  );
                add("base122-inline", f.texts.base122, peers.local.inline122);
                add("base122-block", f.texts.base122, peers.local.block122);
                add("base122-counted", f.texts.base122, peers.local.counted122);
                add("base122-fork", f.texts.base122, peers.fork.decode);
                add("base122-reference", f.texts.base122, peers.reference122);
                add("pair-none", f.texts.pair, glyph.binary);
                add("utf8-data", f.texts["utf8-data"], (s) =>
                  reference.arithmeticDecode(s, f.bytes, alphabet, true, cdf),
                );
                add("utf8-fast-experiment", f.texts["utf8-data"], (s) =>
                  fast.decodeDenseBrowser(s, f.bytes),
                );
                add("utf8-clean", f.texts["utf8-clean"], (s) =>
                  reference.decodeArithmetic(s, f.bytes, {
                    profile: "utf8-clean",
                  }),
                );
                add("utf8-template", f.texts["utf8-template"], (s) =>
                  reference.decodeArithmetic(s, f.bytes, {
                    profile: "utf8-template",
                  }),
                );
              }
              let sink = 0;
              for (const j of jobs) {
                const out = j.fn(j.text),
                  hash = await crypto.subtle.digest("SHA-256", out);
                const actual = Array.from(new Uint8Array(hash), (b) =>
                  b.toString(16).padStart(2, "0"),
                ).join("");
                if (
                  out.length !== fixtures[j.i].bytes ||
                  actual !== fixtures[j.i].sha256
                )
                  throw Error("Bytes differ: " + j.variant);
              }
              const measure = (j, count) => {
                const start = performance.now();
                for (let k = 0; k < count; k++) {
                  const out = j.fn(j.text);
                  sink = (sink + out.length + out[k % out.length]) | 0;
                }
                return (performance.now() - start) / count;
              };
              for (const j of jobs)
                measure(j, fixtures[j.i].bytes <= 1024 ? 100 : 3);
              for (let round = 0; round < rounds; round++)
                for (let n = 0; n < jobs.length; n++) {
                  const j = jobs[(n + round * 7) % jobs.length],
                    bytes = fixtures[j.i].bytes;
                  j.samples.push(
                    measure(j, bytes <= 1024 ? 100 : bytes <= 65536 ? 5 : 1),
                  );
                }
              globalThis.sink = sink;
              return jobs.map((j) => ({
                i: j.i,
                variant: j.variant,
                samples: j.samples,
                medianMs: [...j.samples].sort((a, b) => a - b)[
                  j.samples.length >> 1
                ],
              }));
            },
            {
              sources: [
                uri(bundle),
                uri(peerSource),
                uri(fastSource),
                uri(glyphSource),
              ],
              fixtures,
              rounds,
            },
          );
          measurements.push(
            ...timing.map(({ i, ...r }) => ({
              browser: browser.version(),
              run,
              label: fixtures[i].label,
              inputBytes: fixtures[i].bytes,
              ...r,
            })),
          );
          console.log(
            JSON.stringify({
              browser: browser.version(),
              run,
              cases: timing.length,
            }),
          );
        } finally {
          await browser.close();
        }
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const environment = {
    recordedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    runs,
    rounds,
    integrity: "none for every variant",
    format: "candidate format checks differ; Pair uses none build",
    scope:
      "resident parsed string -> fresh bytes; encoding, loading, hashing checks and imports excluded",
    sources: Object.fromEntries(
      [
        "benchmarks/experiments/utf8/reference/codec.mjs",
        "benchmarks/experiments/utf8/reference/arithmetic.mjs",
        "benchmarks/experiments/utf8/dense-browser.mjs",
        "generated/encoding-comparison/competitors.mjs",
        "dist/none.min.mjs",
      ].map((file) => [file, sha(fs.readFileSync(path.join(root, file)))]),
    ),
    inputs: fixtures.map(({ texts, ...f }) => f),
    note: "Independent browser-fast reconstruction; optimized files named at the end of the supplied document are absent. No claim to reproduce those exact implementations or timings.",
  };
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      { environment, sizes, compatibility, measurements },
      null,
      2,
    ) + "\n",
  );
  const writeCsv = (name, rows, columns) =>
    fs.writeFileSync(
      path.join(output, name),
      columns.join(",") +
        "\n" +
        rows.map((r) => columns.map((c) => r[c] ?? "").join(",")).join("\n") +
        "\n",
    );
  writeCsv("sizes.csv", sizes, [
    "label",
    "variant",
    "inputBytes",
    "payloadBytes",
    "jsonStringBytes",
    "htmlBytes",
    "standaloneCodeBytes",
  ]);
  writeCsv(
    "decode.csv",
    measurements.map((r) => ({
      ...r,
      ...Object.fromEntries(r.samples.map((s, i) => ["sample" + (i + 1), s])),
    })),
    [
      "browser",
      "run",
      "label",
      "inputBytes",
      "variant",
      "medianMs",
      ...Array.from({ length: rounds }, (_, i) => "sample" + (i + 1)),
    ],
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
