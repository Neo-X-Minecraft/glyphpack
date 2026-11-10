/* Run frozen experiments in the actual browser. Native Rust owns fixtures and
 * hosting; timings include complete calls, with preparation outside intervals. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  origin = process.argv[2],
  quick = process.argv[3] === "history-smoke",
  phase = process.env.HISTORY_PHASE || "all";
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8")),
  work = "generated/history",
  out = path.join(root, "generated/results/history");
fs.mkdirSync(out, { recursive: true });
const manifest = read(work + "/manifest.json"),
  target =
    process.env.CHROMIUM_VERSION || read("benchmarks/chromium.json").version;
const digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
const median = (v) => {
  v = v.slice().sort((a, b) => a - b);
  return (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2;
};
const inputs = manifest.inputs.map((row) => {
  const raw = fs.readFileSync(path.join(root, work, row.binary)),
    sha256 = digest(raw);
  if (row.expectedSha256)
    assert.equal(
      sha256,
      row.expectedSha256,
      "Original bytes changed: " + row.label,
    );
  const packetSha256 = Object.fromEntries(
    [
      ["legacy", row.packets.legacy],
      ...["fixed", "adaptive"].flatMap((policy) =>
        ["none", "fast", "secure"].map((mode) => [
          policy + "/" + mode,
          row.packets[policy][mode],
        ]),
      ),
    ].map(([key, file]) => [
      key,
      digest(fs.readFileSync(path.join(root, work, file))),
    ]),
  );
  return { ...row, sha256, packetSha256 };
});
const sources = manifest.sources.map((row) => {
  const source = fs.readFileSync(path.join(root, row.path), "utf8");
  return {
    ...row,
    source,
    sha256: digest(Buffer.from(source)),
    bytes: Buffer.byteLength(source),
  };
});
const report = {
  schema: 1,
  runnerSha256: digest(fs.readFileSync(__filename)),
  nativePreparationSha256: digest(
    fs.readFileSync(path.join(root, "src/tooling/history.rs")),
  ),
  rustHashSourceSha256: digest(fs.readFileSync(path.join(root, "src/hash.rs"))),
  relatedSourceHashes: Object.fromEntries(
    [
      "tests/reference/full.js",
      "tests/reference/profiles.json",
      "generated/test-vectors.json",
      "tests/fixtures/hash-candidates.js",
      "tests/fixtures/blake3-loop.js",
      "tests/fixtures/blake3-loop-stop.js",
      "tests/fixtures/blake3-unrolled.js",
      "tests/vendor/hashes/noble-blake3.min.js",
      "tests/vendor/hashes/blake3.umd.min.js",
      "benchmarks/fixtures/rust-hashes.rs",
      "generated/history/rust-hashes.wasm",
    ].map((p) => [p, digest(fs.readFileSync(path.join(root, p)))]),
  ),
  releasedCodecSha256: digest(
    fs.readFileSync(path.join(root, "dist/full.min.mjs")),
  ),
  pass: false,
  quick,
  commit: require("node:child_process")
    .execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root })
    .trim(),
  date: new Date().toISOString(),
  browser: target,
  architecture: os.arch(),
  cpus: os.cpus().length,
  cpuModels: [...new Set(os.cpus().map((c) => c.model))],
  originalInputs: inputs
    .filter((i) => i.original)
    .map(({ label, bytes, sha256 }) => ({ label, bytes, sha256 })),
  inputs: inputs.map(({ label, bytes, sha256, packetSha256 }) => ({
    label,
    bytes,
    sha256,
    packetSha256,
  })),
  sources: sources.map(({ source, ...r }) => r),
  methodology: {
    screen:
      "all archived source files, public random/zero 64 KiB and random 1 MiB; two warmups and seven measured calibrated batches",
    confirmation:
      "two screened finalists per family/policy plus both production backends; three fresh processes, three warmups and nine measured batches",
    timed:
      "resident string to fresh bytes, selected validation/hash included; mask and legacy header policies labeled",
    excluded:
      "input loading, source/module initialization, SHA-256 correctness checks, calibration",
    calibration:
      "each path targets >=2 ms; small cases are batches, not tail latency observations",
    limits:
      "single unpinned host; historical sources have differing validation policies and are NOT deployment candidates; original input bytes are not published",
  },
};
// A phase can be resumed only against exactly the same code and byte inputs.
// This prevents a partial rerun from silently mixing quick/full campaigns.
report.campaignSha256 = digest(
  JSON.stringify({
    runner: report.runnerSha256,
    preparation: report.nativePreparationSha256,
    codec: report.releasedCodecSha256,
    related: report.relatedSourceHashes,
    inputs: report.inputs,
    sources: report.sources,
    quick,
  }),
);
function save(name, value) {
  fs.writeFileSync(
    path.join(out, name + ".json"),
    JSON.stringify(
      { ...value, campaignSha256: report.campaignSha256 },
      null,
      2,
    ) + "\n",
  );
}
save("manifest-current", report);
async function launch() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_BIN || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  assert.equal(browser.version(), target);
  const page = await browser.newPage();
  await page.goto(origin + "/benchmarks/blank.html");
  await page.evaluate(() => {
    window.historyHex = (bytes) =>
      Array.from(new Uint8Array(bytes), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
  });
  const version = await (
    await page.context().newCDPSession(page)
  ).send("Browser.getVersion");
  report.v8 = version.jsVersion;
  return { browser, page };
}
function choices(profile) {
  if (profile === "full")
    return [false, true].flatMap((verifyFormat) =>
      ["none", "fast", "secure"].map((verifyData) => ({
        verifyFormat,
        verifyData,
      })),
    );
  return [
    {
      verifyFormat: !["none", "base", "legacy"].includes(profile),
      verifyData: ["none", "base", "format", "legacy"].includes(profile)
        ? "none"
        : profile,
    },
  ];
}
function entriesFor(rows) {
  return rows.flatMap((row) => {
    const legacy =
      row.profile === "legacy" || row.variant === "v2-before-hotloop";
    const opts =
      row.variant === "v2-before-hotloop"
        ? [
            {
              verifyFormat: true,
              verifyData: "none",
              legacy: true,
              verify: false,
            },
          ]
        : choices(row.profile);
    return opts.map((options) => ({
      ...row,
      source: undefined,
      id: row.id + "/" + +options.verifyFormat + "/" + options.verifyData,
      sourceId: row.id,
      options,
      packetKind: legacy ? "legacy" : "adaptive",
    }));
  });
}
const archived = entriesFor(sources),
  production = ["js-reference", "wasm-release"].flatMap((family) =>
    [false, true].flatMap((verifyFormat) =>
      ["none", "fast", "secure"].flatMap((verifyData) =>
        [false, true].map((memoryHeavy) => ({
          id:
            family +
            "/" +
            +verifyFormat +
            "/" +
            verifyData +
            "/" +
            +memoryHeavy,
          sourceId: family,
          family,
          variant: memoryHeavy ? "heavy" : "compact",
          profile: "full",
          options: { verifyFormat, verifyData, memoryHeavy },
          packetKind: "adaptive",
        })),
      ),
    ),
  );
async function init(page, rows = sources) {
  return page.evaluate(async (rows) => {
    window.historyFns = new Map();
    const init = [];
    for (const row of rows) {
      const start = performance.now();
      historyFns.set(row.id, new Function(row.source + ";return binary")());
      init.push({ id: row.id, ms: performance.now() - start });
    }
    const start = performance.now(),
      { binary } = await import("/dist/full.min.mjs");
    historyFns.set("wasm-release", binary);
    init.push({ id: "wasm-release", ms: performance.now() - start });
    const source = await (await fetch("/tests/reference/full.js")).text();
    historyFns.set("js-reference", new Function(source + ";return binary")());
    window.historyHex = (b) =>
      Array.from(new Uint8Array(b), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
    return init;
  }, rows);
}
// Calibrate each complete API call, check bytes independently, then rotate timing order.
// Batches reduce timer quantization; they do not measure per-call latency tails.
async function measure(
  page,
  sample,
  entries,
  { run = 0, warmups = 3, rounds = 9, mask = "adaptive" } = {},
) {
  const result = await page.evaluate(
    async ({ sample, entries, run, warmups, rounds, mask }) => {
      const texts = {};
      for (const kind of [
        ...new Set(
          entries.map((e) => (e.packetKind === "legacy" ? "legacy" : mask)),
        ),
      ]) {
        texts[kind] = {};
        for (const mode of kind === "legacy"
          ? ["none"]
          : ["none", "fast", "secure"]) {
          const file =
            kind === "legacy"
              ? sample.packets.legacy
              : sample.packets[kind][mode];
          texts[kind][mode] = new TextDecoder("utf-16le").decode(
            await (await fetch("/generated/history/" + file)).arrayBuffer(),
          );
        }
      }
      let paths = entries.map((e) => ({
        ...e,
        fn: historyFns.get(e.sourceId),
        text: texts[e.packetKind === "legacy" ? "legacy" : mask][
          e.packetMode || e.options.verifyData
        ],
        batch: 1,
        times: [],
      }));
      let sink = 0;
      const rejected = [];
      for (const p of paths) {
        try {
          const start = performance.now(),
            value = p.fn(p.text, p.options);
          p.firstForInputMs = performance.now() - start;
          if (
            value.length !== sample.bytes ||
            historyHex(await crypto.subtle.digest("SHA-256", value)) !==
              sample.sha256
          )
            throw Error("Byte mismatch");
        } catch (error) {
          if (
            [
              "wasm-release",
              "js-reference",
              "profile-wasm",
              "profile-js",
            ].includes(p.family)
          )
            throw Error(p.id + ": " + error.message);
          rejected.push({
            id: p.id,
            sourceId: p.sourceId,
            error: error.message,
          });
        }
      }
      paths = paths.filter((p) => !rejected.some((r) => r.id === p.id));
      const batch = (p, n) => {
        for (let i = 0; i < n; i++) {
          const b = p.fn(p.text, p.options);
          sink ^= b[(i * 997) % b.length] || 0;
        }
      };
      for (const p of paths) {
        for (;;) {
          let fastest = Infinity;
          for (let i = 0; i < 2; i++) {
            const t = performance.now();
            batch(p, p.batch);
            fastest = Math.min(fastest, performance.now() - t);
          }
          if (fastest >= 2 || p.batch >= 4096) break;
          p.batch *= 2;
        }
      }
      for (let round = -warmups; round < rounds; round++)
        for (let j = 0; j < paths.length; j++) {
          const p = paths[(j + round + run + paths.length) % paths.length],
            start = performance.now();
          batch(p, p.batch);
          p.times.push({
            round,
            phase: round < 0 ? "warmup" : "measured",
            ms: (performance.now() - start) / p.batch,
            order: j,
          });
        }
      return {
        rows: paths.map(({ fn, text, ...p }) => ({ ...p, sink })),
        rejected,
      };
    },
    { sample, entries, run, warmups, rounds, mask },
  );
  for (const item of result.rejected)
    report.validationFailures = (report.validationFailures || []).concat({
      ...item,
      dataset: sample.label,
      mask,
    });
  return result.rows.map((r) => ({
    ...r,
    run: run + 1,
    dataset: sample.label,
    bytes: sample.bytes,
    inputSha256: sample.sha256,
    maskPolicy: r.packetKind === "legacy" ? "fixed-zero-legacy" : mask,
    medianMs: median(
      r.times.filter((t) => t.phase === "measured").map((t) => t.ms),
    ),
  }));
}
// Screen every archived source before choosing a bounded set of finalists.
async function screen() {
  const { browser, page } = await launch();
  const rows = [];
  try {
    report.initialization = await init(page);
    let samples = inputs.filter((i) =>
      ["random-65536", "zeros-65536", "random-1048576"].includes(i.label),
    );
    if (quick) samples = samples.slice(0, 1);
    for (const sample of samples) {
      const measured = await measure(
        page,
        sample,
        [...archived, ...production],
        { warmups: 2, rounds: 7 },
      );
      rows.push(...measured);
      save("screen.partial", { rows });
      console.log(
        JSON.stringify({
          phase: "screen",
          dataset: sample.label,
          paths: measured.length,
        }),
      );
    }
    save("screen", {
      pass: true,
      initialization: report.initialization,
      validationFailures: report.validationFailures || [],
      rows,
    });
  } finally {
    await browser.close();
  }
  return rows;
}
function finalists(rows) {
  const scores = new Map();
  for (const r of rows.filter(
    (r) => !["wasm-release", "js-reference"].includes(r.family),
  )) {
    if (!scores.has(r.id)) scores.set(r.id, []);
    scores.get(r.id).push(r.medianMs);
  }
  const grouped = new Map();
  for (const e of archived) {
    if (!scores.has(e.id)) continue;
    const key = JSON.stringify([e.family, e.options]);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      entry: e,
      score: Math.exp(
        scores.get(e.id).reduce((s, n) => s + Math.log(Math.max(n, 1e-12)), 0) /
          scores.get(e.id).length,
      ),
    });
  }
  const selected = [...grouped.values()].flatMap((g) =>
    g
      .sort((a, b) => a.score - b.score)
      .slice(0, 2)
      .map((r) => r.entry),
  );
  return [...selected, ...production];
}
// Use fresh processes and original binaries to check that screening generalizes.
async function confirm(rows) {
  const entries = finalists(rows);
  report.finalists = entries.map(({ id, family, options }) => ({
    id,
    family,
    options,
  }));
  const results = [];
  for (let run = 0; run < (quick ? 1 : 3); run++) {
    const { browser, page } = await launch();
    try {
      await init(page);
      const samples = inputs.filter((i) =>
        quick
          ? i.label === "random-65536"
          : i.original ||
            [
              "random-128",
              "zeros-128",
              "random-2048",
              "zeros-2048",
              "random-65536",
              "ones-1048576",
              "zeros-1048576",
              "sequential-1048576",
              "random-1048576",
            ].includes(i.label),
      );
      for (const sample of samples) {
        const measured = await measure(page, sample, entries, { run });
        results.push(...measured);
        save("confirmation.partial", { rows: results });
        console.log(
          JSON.stringify({
            phase: "confirmation",
            run: run + 1,
            dataset: sample.label,
            paths: measured.length,
          }),
        );
      }
    } finally {
      await browser.close();
    }
  }
  save("confirmation", { pass: true, rows: results });
}
// Cross input patterns and mask policies; do not infer a universal size cutoff.
async function small() {
  const sourcesSmall = sources.filter((s) => s.family === "small-stores"),
    entries = [...entriesFor(sourcesSmall), ...production];
  const results = [];
  for (let run = 0; run < (quick ? 1 : 3); run++) {
    const { browser, page } = await launch();
    try {
      await init(page, sourcesSmall);
      const samples = inputs.filter(
        (i) => !i.original && i.bytes <= (quick ? 128 : 65536),
      );
      for (const sample of samples)
        for (const mask of ["fixed", "adaptive"]) {
          const measured = await measure(page, sample, entries, {
            run,
            mask,
            warmups: 3,
            rounds: 7,
          });
          results.push(...measured);
          save("small-stores.partial", { rows: results });
        }
      console.log(
        JSON.stringify({
          phase: "small-stores",
          run: run + 1,
          cases: samples.length * 2,
        }),
      );
    } finally {
      await browser.close();
    }
  }
  save("small-stores", { pass: true, rows: results });
}
// Compare every permitted option combination in all 63 specialized builds.
async function profiles() {
  const old = read("tests/reference/profiles.json"),
    current = read("generated/test-vectors.json").profiles;
  assert.equal(old.length, 63);
  const results = [];
  for (let run = 0; run < (quick ? 1 : 3); run++) {
    const { browser, page } = await launch();
    try {
      const definitions = await page.evaluate(
        async ({ old, current }) => {
          window.historyFns = new Map();
          const entries = [];
          for (let i = 0; i < old.length; i++)
            for (const backend of ["profile-js", "profile-wasm"]) {
              const row = (backend === "profile-js" ? old : current)[i],
                sourceId = backend + "/" + i;
              historyFns.set(
                sourceId,
                backend === "profile-js"
                  ? new Function(row.source + ";return binary")()
                  : (
                      await import(
                        "data:text/javascript;base64," + btoa(row.source)
                      )
                    ).binary,
              );
              for (const verifyFormat of row.formats)
                for (const verifyData of row.modes)
                  for (const memoryHeavy of row.memories) {
                    entries.push({
                      id:
                        sourceId +
                        "/" +
                        +verifyFormat +
                        "/" +
                        verifyData +
                        "/" +
                        +memoryHeavy,
                      sourceId,
                      family: backend,
                      variant: String(i),
                      profile: "selected",
                      options: { verifyFormat, verifyData, memoryHeavy },
                      packetKind: "adaptive",
                    });
                  }
            }
          return entries;
        },
        { old, current },
      );
      assert.equal(definitions.length, 384);
      for (const sample of inputs.filter(
        (i) => i.label === "random-65536" || (!quick && i.label === "runtime"),
      )) {
        const measured = await measure(page, sample, definitions, { run });
        results.push(...measured);
        console.log(
          JSON.stringify({
            phase: "profiles",
            run: run + 1,
            dataset: sample.label,
            paths: measured.length,
          }),
        );
      }
    } finally {
      await browser.close();
    }
  }
  save("profiles", { pass: true, rows: results });
}
// Include skipping a stored digest, and fixed/adaptive XOR masks, in every runtime setting.
async function masks() {
  const rows = [];
  for (let run = 0; run < (quick ? 1 : 3); run++) {
    const { browser, page } = await launch();
    try {
      await init(page, []);
      const entries = production.flatMap((e) =>
        ["none", "fast", "secure"]
          .filter(
            (mode) =>
              e.options.verifyData === "none" || e.options.verifyData === mode,
          )
          .map((packetMode) => ({
            ...e,
            id: e.id + "/stored-" + packetMode,
            packetMode,
          })),
      );
      for (const sample of inputs.filter((i) =>
        quick
          ? i.label === "random-65536"
          : i.original ||
            ["ones-1048576", "zeros-1048576", "random-65536"].includes(i.label),
      ))
        for (const mask of ["fixed", "adaptive"]) {
          rows.push(...(await measure(page, sample, entries, { run, mask })));
          save("masks.partial", { rows });
        }
      console.log(JSON.stringify({ phase: "masks", run: run + 1 }));
    } finally {
      await browser.close();
    }
  }
  save("masks", { pass: true, rows });
}
// Reuse the production transport harness with the exact archived encoded strings.
async function peers() {
  require("node:child_process").execFileSync(
    process.execPath,
    [path.join(root, "benchmarks/run.cjs"), origin, quick ? "smoke" : "run"],
    { cwd: root, env: process.env, stdio: "inherit" },
  );
  for (const extension of ["csv"]) {
    const name = quick ? "smoke" : "encoding-decode-benchmark";
    fs.copyFileSync(
      path.join(root, "generated/results", name + "." + extension),
      path.join(out, "peers." + extension),
    );
  }
  const name = quick ? "smoke" : "encoding-decode-benchmark";
  save("peers", read("generated/results/" + name + ".json"));
}
// Load independent JS and Wasm hashes; copying into Wasm memory is part of its cost.
async function hashInit(page) {
  const names = ["loop", "loop-stop", "unrolled"],
    source = Object.fromEntries(
      names.map((n) => [
        n,
        fs.readFileSync(
          path.join(root, "tests/fixtures/blake3-" + n + ".js"),
          "utf8",
        ),
      ]),
    );
  source.noncrypto = fs.readFileSync(
    path.join(root, "tests/fixtures/hash-candidates.js"),
    "utf8",
  );
  source.noble = fs.readFileSync(
    path.join(root, "tests/vendor/hashes/noble-blake3.min.js"),
    "utf8",
  );
  source.wasm = fs.readFileSync(
    path.join(root, "tests/vendor/hashes/blake3.umd.min.js"),
    "utf8",
  );
  await page.evaluate(async (source) => {
    window.hashFns = new Map(
      Object.entries(
        new Function(
          source.noncrypto + ";return {crc32,crc32Slice8,murmur3,xxhash32}",
        )(),
      ),
    );
    for (const name of ["loop", "loop-stop", "unrolled"])
      hashFns.set(
        "BLAKE3 " + name,
        new Function(source[name] + ";return blake3")(),
      );
    hashFns.set(
      "BLAKE3 Noble",
      new Function(source.noble + ";return Blake3Noble.blake3")(),
    );
    hashFns.set(
      "BLAKE3 hash-wasm",
      new Function(source.wasm + ";return hashwasm.blake3")(),
    );
    hashFns.set("SHA256 native", (d) => crypto.subtle.digest("SHA-256", d));
    const api = (
      await WebAssembly.instantiate(
        await (
          await fetch("/generated/history/rust-hashes.wasm")
        ).arrayBuffer(),
      )
    ).instance.exports;
    const write = (data) => {
      const p = api.reserve(data.length);
      if (!p) throw Error("Hash reserve failed");
      new Uint8Array(api.memory.buffer, p, data.length).set(data);
    };
    hashFns.set("BLAKE3 Rust-Wasm", (data) => {
      write(data);
      return new Uint8Array(
        api.memory.buffer,
        api.blake3(data.length),
        32,
      ).slice();
    });
    hashFns.set("xxhash32 Rust-Wasm", (data) => {
      write(data);
      return api.xxhash32(data.length) >>> 0;
    });
    window.hashHex = (v) =>
      typeof v === "string"
        ? v
        : Array.from(
            new Uint8Array(
              v.buffer || v,
              v.byteOffset || 0,
              v.byteLength || v.length,
            ),
            (x) => x.toString(16).padStart(2, "0"),
          ).join("");
  }, source);
}
// Check official BLAKE3 vectors and unaligned views before timing complete hash APIs.
async function hashes() {
  const results = [];
  for (let run = 0; run < (quick ? 1 : 3); run++) {
    const { browser, page } = await launch();
    try {
      await hashInit(page);
      const official = read("tests/fixtures/blake3-vectors.json").cases;
      const checks = await page.evaluate(async (vectors) => {
        let count = 0;
        for (const row of vectors) {
          const bytes = Uint8Array.from(
            { length: row.input_len },
            (_, i) => i % 251,
          );
          for (const [name, fn] of hashFns)
            if (name.startsWith("BLAKE3")) {
              if (hashHex(await fn(bytes)) !== row.hash.slice(0, 64))
                throw Error(name + " official mismatch " + bytes.length);
              count++;
            }
        }
        return count;
      }, official);
      report.hashOfficialChecks = checks;
      for (const sample of inputs.filter((i) =>
        quick
          ? i.label === "random-65536"
          : i.original ||
            ["random-128", "random-65536", "random-1048576"].includes(i.label),
      )) {
        const rows = await page.evaluate(async (sample) => {
          const raw = new Uint8Array(
            await (
              await fetch("/generated/history/" + sample.binary)
            ).arrayBuffer(),
          );
          for (const offset of [0, 1, 2, 3]) {
            const data = new Uint8Array(raw.length + offset + 8).subarray(
              offset,
              offset + raw.length,
            );
            data.set(raw);
            for (const [name, fn] of hashFns) {
              const value = await fn(data);
              if (name.startsWith("BLAKE3") && hashHex(value) !== sample.blake3)
                throw Error(name + " mismatch");
              const key = name.startsWith("crc32")
                ? "crc32"
                : name.startsWith("xxhash32")
                  ? "xxhash32"
                  : name === "murmur3"
                    ? "murmur3"
                    : null;
              if (key && value !== sample[key])
                throw Error(name + " numeric mismatch");
            }
          }
          const entries = [...hashFns].map(([id, fn]) => ({
            id,
            fn,
            times: [],
            batch: 1,
          }));
          let sink = 0;
          for (const e of entries) {
            for (;;) {
              let fastest = Infinity;
              for (let j = 0; j < 2; j++) {
                const start = performance.now();
                for (let n = 0; n < e.batch; n++) await e.fn(raw);
                fastest = Math.min(fastest, performance.now() - start);
              }
              if (fastest >= 2 || e.batch >= 4096) break;
              e.batch *= 2;
            }
          }
          for (let round = -3; round < 9; round++)
            for (let j = 0; j < entries.length; j++) {
              const e = entries[(j + round + entries.length) % entries.length],
                start = performance.now();
              for (let n = 0; n < e.batch; n++) {
                const value = await e.fn(raw);
                sink ^=
                  typeof value === "number"
                    ? value
                    : typeof value === "string"
                      ? value.charCodeAt(0)
                      : new Uint8Array(
                          value.buffer || value,
                          value.byteOffset || 0,
                          1,
                        )[0];
              }
              e.times.push({
                round,
                phase: round < 0 ? "warmup" : "measured",
                ms: (performance.now() - start) / e.batch,
              });
            }
          return entries.map(({ fn, ...e }) => ({ ...e, sink }));
        }, sample);
        results.push(
          ...rows.map((r) => ({
            ...r,
            run: run + 1,
            dataset: sample.label,
            bytes: sample.bytes,
            inputSha256: sample.sha256,
            medianMs: median(
              r.times.filter((t) => t.phase === "measured").map((t) => t.ms),
            ),
          })),
        );
        console.log(
          JSON.stringify({
            phase: "hashes",
            run: run + 1,
            dataset: sample.label,
            paths: rows.length,
          }),
        );
      }
    } finally {
      await browser.close();
    }
  }
  save("hashes", { pass: true, rows: results });
}
// Alternate both versions in quick succession, across five independent browsers.
async function permutation() {
  const results = [];
  const sample =
    inputs.find((i) => i.label === "random-1048576") ||
    inputs.find((i) => i.label === "random-65536");
  for (let run = 0; run < (quick ? 1 : 5); run++) {
    const { browser, page } = await launch();
    try {
      await hashInit(page);
      const result = await page.evaluate(
        async ({ sample, run, quick }) => {
          const bytes = new Uint8Array(
              await (
                await fetch("/generated/history/" + sample.binary)
              ).arrayBuffer(),
            ),
            fns = ["BLAKE3 loop", "BLAKE3 loop-stop"].map((n) =>
              hashFns.get(n),
            ),
            times = [[], []];
          for (const fn of fns)
            if (hashHex(fn(bytes)) !== sample.blake3)
              throw Error("permutation digest mismatch");
          let sink = 0;
          for (let i = -12; i < (quick ? 7 : 30); i++)
            for (let j = 0; j < 2; j++) {
              const index = (i + j + run + 12) % 2,
                start = performance.now(),
                value = fns[index](bytes),
                elapsed = performance.now() - start;
              sink ^= value[0];
              if (i >= 0) times[index].push(elapsed);
            }
          return { times, sink };
        },
        { sample, run, quick },
      );
      results.push({
        run: run + 1,
        dataset: sample.label,
        bytes: sample.bytes,
        ...result,
        regularMs: median(result.times[0]),
        earlyExitMs: median(result.times[1]),
      });
    } finally {
      await browser.close();
    }
  }
  save("permutation", { pass: true, rows: results });
}
(async () => {
  let screened;
  if (["all", "screen", "confirm"].includes(phase)) {
    if (phase === "confirm") {
      const previous = read("generated/results/history/screen.json");
      assert.equal(
        previous.campaignSha256,
        report.campaignSha256,
        "Screening belongs to another campaign",
      );
      screened = previous.rows;
    } else screened = await screen();
    if (phase !== "screen") await confirm(screened);
  }
  if (["all", "small"].includes(phase)) await small();
  if (["all", "profiles"].includes(phase)) await profiles();
  if (["all", "hashes"].includes(phase)) await hashes();
  if (["all", "permutation"].includes(phase)) await permutation();
  if (["all", "masks"].includes(phase)) await masks();
  if (["all", "peers"].includes(phase)) await peers();
  report.pass = true;
  report.finishedAt = new Date().toISOString();
  save("manifest-" + phase, report);
  save("manifest-current", report);
  if (phase === "all") save("manifest", report);
  console.log(
    JSON.stringify({
      pass: true,
      phase,
      sources: sources.length,
      originalInputs: report.originalInputs.length,
      browser: target,
    }),
  );
})().catch((e) => {
  save("failure", { error: e.stack });
  console.error(e);
  process.exitCode = 1;
});
