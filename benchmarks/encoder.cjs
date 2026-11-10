/* Public fixtures prepared by Rust. This harness times the complete browser
 * encoder bridge, including output-string consumption, never fixture loading. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  os = require("node:os");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  [before, after, output = "generated/results/encoder-browser.json"] =
    process.argv.slice(2);
const quick = process.env.ENCODER_QUICK === "1",
  large = process.env.ENCODER_LARGE === "1",
  runs = Number(process.env.ENCODER_RUNS || (quick ? 1 : 3));
const median = (a) => {
  a = a.slice().sort((a, b) => a - b);
  return (a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2;
};
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
(async () => {
  assert(
    before && after,
    "Usage: node benchmarks/encoder.cjs before.mjs after.mjs [output.json]",
  );
  assert(Number.isInteger(runs) && runs > 0 && runs <= 10, "Invalid run count");
  const files = [before, after],
    sources = files.map((p) => fs.readFileSync(p));
  const hostFile = fs.existsSync(
    path.join(path.dirname(after), "encoder-host.mjs"),
  )
    ? path.join(path.dirname(after), "encoder-host.mjs")
    : path.join(root, "site/encoder-host.mjs");
  const host = fs.readFileSync(hostFile),
    decoder = fs.readFileSync(path.join(root, "dist/full.min.mjs"));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "generated/encoder-benchmark/inputs.json")),
  );
  const inputs = manifest.filter(
    (x) =>
      (large || x.label !== "random-10MiB") &&
      (!quick ||
        ["random-1KiB", "random-64KiB", "decoder-wasm"].includes(x.label)),
  );
  const report = {
    schema: 1,
    kind: "browser",
    date: new Date().toISOString(),
    architecture: os.arch(),
    browser: null,
    modules: files.map((p, i) => ({
      path: p,
      sha256: hash(sources[i]),
      bytes: sources[i].length,
    })),
    host: { path: hostFile, sha256: hash(host) },
    methodology: {
      runs,
      warmups: 3,
      measured: 9,
      order: "alternate implementations each round",
      calibration: "both implementations >=2 ms per batch, cap 2048 calls",
      timed:
        "complete input copy, Rust/Wasm encode, JS string construction and one character consumed per result",
      excluded:
        "fixture loading, imports, correctness comparisons and round-trip verification",
      cache: "warm instances, alphabet and output capacity",
      limits:
        "unpinned host; batch averages are not latency tails; legacy strings may require materialization when consumed",
    },
    validation: [],
    rows: [],
  };
  for (let run = 0; run < runs; run++) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_BIN || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    try {
      report.browser = browser.version();
      assert.equal(
        report.browser,
        process.env.CHROMIUM_VERSION || require("./chromium.json").version,
      );
      const page = await browser.newPage();
      const checks = await page.evaluate(
        async ({ sources, host, decoder }) => {
          const load = async (s) => import("data:text/javascript;base64," + s);
          window.engines = await Promise.all(
            sources.map(async (s) => (await load(s)).api),
          );
          window.nativeEncode = (await load(host)).encode;
          window.decode = (await load(decoder)).binary;
          window.encode = (index, input, mode, exact) => {
            const api = engines[index];
            if (index === 1) return nativeEncode(api, input, mode, exact);
            const ptr = api.input_ptr(input.length);
            new Uint8Array(api.memory.buffer, ptr, input.length).set(input);
            if (api.encode(mode, +exact))
              throw Error("Reference encoder failed");
            const units = new Uint16Array(
              api.memory.buffer,
              api.output_ptr(),
              api.output_len(),
            );
            let text = "";
            for (let i = 0; i < units.length; i += 8192)
              text += String.fromCharCode(...units.subarray(i, i + 8192));
            return text;
          };
          const alphabet = [];
          for (let c = 32; c < 65534; c++) {
            if (
              c === 60 ||
              (c >= 127 && c <= 159) ||
              (c >= 55296 && c <= 57343) ||
              (c >= 64976 && c <= 65007) ||
              c === 65279 ||
              c === 8232 ||
              c === 8233
            )
              continue;
            alphabet.push(c);
          }
          const memory = { buffer: new ArrayBuffer(alphabet.length * 2) },
            v = new DataView(memory.buffer);
          alphabet.forEach((c, i) => v.setUint16(i * 2, c, true));
          const api = {
            memory,
            input_ptr: () => 0,
            encode: () => 0,
            output_ptr: () => 0,
            output_len: () => alphabet.length,
          };
          const text = nativeEncode(api, new Uint8Array(0), 0, false);
          for (let i = 0; i < alphabet.length; i++)
            if (text.charCodeAt(i) !== alphabet[i])
              throw Error("UTF-16 bridge changed a symbol");
          new Uint8Array(memory.buffer).fill(0);
          if (text.charCodeAt(100) !== alphabet[100])
            throw Error("Output aliases mutable memory");
          return { alphabetUnits: alphabet.length, ownedString: true };
        },
        {
          sources: sources.map((s) => s.toString("base64")),
          host: host.toString("base64"),
          decoder: decoder.toString("base64"),
        },
      );
      report.validation.push({ run: run + 1, ...checks });
      for (const input of inputs) {
        const data = fs.readFileSync(path.join(root, input.binary));
        assert.equal(data.length, input.bytes);
        const rows = await page.evaluate(
          ({ data, input, run }) => {
            const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
              rows = [];
            for (const mode of [0, 1, 2])
              for (const exact of [false, true]) {
                let outputLength;
                {
                  const a = encode(0, bytes, mode, exact),
                    b = encode(1, bytes, mode, exact);
                  if (a !== b) throw Error("Encoded text differs");
                  const out = decode(b, {
                    verifyData: ["none", "fast", "secure"][mode],
                  });
                  if (out.length !== bytes.length)
                    throw Error("Round-trip length differs");
                  for (let i = 0; i < out.length; i++)
                    if (out[i] !== bytes[i])
                      throw Error("Round-trip bytes differ");
                  outputLength = b.length;
                }
                let batch = 1,
                  sink = 0;
                const measure = (which) => {
                  const start = performance.now();
                  for (let n = 0; n < batch; n++) {
                    const text = encode(which, bytes, mode, exact);
                    sink ^= text.charCodeAt(text.length >> 1) || 0;
                  }
                  return (performance.now() - start) / batch;
                };
                for (;;) {
                  const fastest = Math.min(measure(0), measure(1)) * batch;
                  if (fastest >= 2 || batch >= 2048) break;
                  batch *= 2;
                }
                const samples = [[], []],
                  order = [];
                for (let round = -3; round < 9; round++)
                  for (let step = 0; step < 2; step++) {
                    const which = (round + step + run + 12) % 2;
                    const ms = measure(which);
                    if (round >= 0) {
                      samples[which].push(ms);
                      order.push(which);
                    }
                  }
                rows.push({
                  dataset: input.label,
                  bytes: input.bytes,
                  input_blake3: input.blake3,
                  integrity: ["none", "fast", "secure"][mode],
                  policy: exact ? "exact" : "sampled",
                  backend: "js-string",
                  run: run + 1,
                  batch,
                  samples,
                  order,
                  output_chars: outputLength,
                  linear_memory_bytes: engines.map(
                    (api) => api.memory.buffer.byteLength,
                  ),
                  sink,
                });
              }
            return rows;
          },
          { data: data.toString("base64"), input, run },
        );
        report.rows.push(...rows);
        console.log(
          JSON.stringify({
            run: run + 1,
            dataset: input.label,
            variants: rows.length,
          }),
        );
      }
    } finally {
      await browser.close();
    }
  }
  const groups = new Map();
  for (const row of report.rows) {
    const key = JSON.stringify([
      row.dataset,
      row.integrity,
      row.policy,
      row.backend,
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  report.summary = [...groups.values()].map((g) => {
    const a = median(g.map((r) => median(r.samples[0]))),
      b = median(g.map((r) => median(r.samples[1])));
    const { dataset, bytes, integrity, policy, backend } = g[0];
    return {
      dataset,
      bytes,
      integrity,
      policy,
      backend,
      before_ms: a,
      after_ms: b,
      speedup: a / b,
    };
  });
  report.pass = true;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      pass: true,
      browser: report.browser,
      cases: report.rows.length,
      output,
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
