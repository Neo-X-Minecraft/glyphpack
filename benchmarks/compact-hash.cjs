/* 0BSD, NeoX. Isolate the two production BLAKE3 implementations. Inputs already
 * reside in Wasm: copying, loading, compilation and validation are not timed.
 * Run from the repository root after sourcing .tools/env.sh. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  os = require("node:os"),
  http = require("node:http"),
  { execFileSync } = require("node:child_process"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  work = path.join(root, "generated/compact-hash"),
  out = path.join(root, "benchmarks/results/compact-hash"),
  runs = Number(process.env.HASH_RUNS || 3),
  rounds = Number(process.env.HASH_ROUNDS || 9),
  sizes = [0, 64, 1024, 4096, 16384, 65536, 1048576, 10485760],
  variants = ["default", "compact"],
  sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const source = path.join(root, "benchmarks/fixtures/rust-hashes.rs");
const binaries = variants.map((variant) => {
  const raw = path.join(work, variant + ".raw.wasm"),
    file = path.join(work, variant + ".wasm");
  execFileSync("rustc", [
    "--edition=2021",
    "--crate-type=cdylib",
    "--target=wasm32v1-none",
    "-Copt-level=3",
    "-Clto=fat",
    "-Ccodegen-units=1",
    "-Cpanic=abort",
    "-Cstrip=symbols",
    "-Ctarget-feature=+simd128",
    "-Clink-arg=-zstack-size=65536",
    ...(variant === "compact" ? ["--cfg", 'feature="compact-hash"'] : []),
    source,
    "-o",
    raw,
  ]);
  execFileSync(path.join(root, "node_modules/.bin/wasm-opt"), [
    raw,
    "-O3",
    "--mvp-features",
    "--enable-mutable-globals",
    "--enable-simd",
    "--converge",
    "--vacuum",
    "--strip-dwarf",
    "--strip-producers",
    "-o",
    file,
  ]);
  const bytes = fs.readFileSync(file);
  return {
    variant,
    sha256: sha(bytes),
    bytes: bytes.length,
    base64: bytes.toString("base64"),
  };
});
const answers = JSON.parse(
  fs.readFileSync(path.join(root, "tests/fixtures/blake3-vectors.json")),
).cases;
(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.end("<!doctype html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const rows = [];
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
          const page = await browser.newPage();
          await page.goto("http://127.0.0.1:" + server.address().port);
          const measured = await page.evaluate(
            async ({ binaries, answers, sizes, rounds }) => {
              const modules = await Promise.all(
                binaries.map(
                  async (b) =>
                    (
                      await WebAssembly.instantiate(
                        Uint8Array.from(atob(b.base64), (c) => c.charCodeAt(0)),
                      )
                    ).instance.exports,
                ),
              );
              const capacity = Math.max(
                ...sizes,
                ...answers.map((a) => a.input_len),
              );
              const views = modules.map((api) => {
                const pointer = api.reserve(capacity);
                if (!pointer) throw Error("Reserve failed");
                const input = new Uint8Array(
                  api.memory.buffer,
                  pointer,
                  capacity,
                );
                for (let i = 0; i < input.length; i++) input[i] = i % 251;
                for (const a of answers) {
                  const digest = new Uint8Array(
                    api.memory.buffer,
                    api.blake3(a.input_len),
                    32,
                  );
                  const hex = Array.from(digest, (b) =>
                    b.toString(16).padStart(2, "0"),
                  ).join("");
                  if (hex !== a.hash.slice(0, 64))
                    throw Error("Official BLAKE3 answer mismatch");
                }
                return new Uint8Array(api.memory.buffer);
              });
              let sink = 0;
              const jobs = modules.flatMap((_, m) =>
                sizes.map((size) => ({ m, size, samples: [] })),
              );
              const measure = (job, count) => {
                const api = modules[job.m],
                  view = views[job.m],
                  size = job.size;
                const start = performance.now();
                for (let i = 0; i < count; i++)
                  sink = (sink + view[api.blake3(size)]) | 0;
                return (performance.now() - start) / count;
              };
              for (const j of jobs) measure(j, j.size <= 1024 ? 10000 : 20);
              for (let r = 0; r < rounds; r++)
                for (let n = 0; n < jobs.length; n++) {
                  const j = jobs[(n + r * 7) % jobs.length];
                  const count =
                    j.size <= 64
                      ? 10000
                      : j.size <= 4096
                        ? 1000
                        : j.size <= 65536
                          ? 100
                          : j.size <= 1048576
                            ? 4
                            : 1;
                  j.samples.push(measure(j, count));
                }
              globalThis.hashSink = sink;
              return jobs.map((j) => {
                const sorted = [...j.samples].sort((a, b) => a - b);
                return {
                  variant: binaries[j.m].variant,
                  inputBytes: j.size,
                  samples: j.samples,
                  medianMs: sorted[sorted.length >> 1],
                };
              });
            },
            { binaries, answers, sizes, rounds },
          );
          rows.push(
            ...measured.map((r) => ({ browser: browser.version(), run, ...r })),
          );
          console.log(
            JSON.stringify({
              browser: browser.version(),
              run,
              officialCases: answers.length * 2,
              cases: measured.length,
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
    arch: process.arch,
    platform: process.platform,
    cpu: os.cpus()[0]?.model,
    runs,
    rounds,
    rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
    binaryen: execFileSync(
      path.join(root, "node_modules/.bin/wasm-opt"),
      ["--version"],
      { encoding: "utf8" },
    ).trim(),
    scope:
      "BLAKE3 only, resident Wasm bytes; call and single digest-byte consumption included; input/output copies, loading and compilation excluded",
    compiler:
      "Rust opt-level=3, fat LTO, one codegen unit, SIMD128; Binaryen O3/converge/vacuum",
    validation:
      "All 35 official BLAKE3 inputs checked against their full 32-byte digests in each fresh process",
    sources: Object.fromEntries(
      [
        "src/hash.rs",
        "src/hash/simd.rs",
        "benchmarks/fixtures/rust-hashes.rs",
      ].map((f) => [f, sha(fs.readFileSync(path.join(root, f)))]),
    ),
    modules: binaries.map(({ base64, ...b }) => b),
  };
  fs.writeFileSync(
    path.join(out, "hash.json"),
    JSON.stringify({ environment, rows }, null, 2) + "\n",
  );
  const columns = [
    "browser",
    "run",
    "variant",
    "inputBytes",
    "medianMs",
    ...Array.from({ length: rounds }, (_, i) => "sample" + (i + 1)),
  ];
  fs.writeFileSync(
    path.join(out, "hash.csv"),
    columns.join(",") +
      "\n" +
      rows
        .map((r) => {
          const row = {
            ...r,
            ...Object.fromEntries(
              r.samples.map((s, i) => ["sample" + (i + 1), s]),
            ),
          };
          return columns.map((c) => row[c]).join(",");
        })
        .join("\n") +
      "\n",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
