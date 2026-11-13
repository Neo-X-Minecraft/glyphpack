/* 0BSD, NeoX. Candidate specialization; only a single chosen kernel ships. */
const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/utf8-wasm"),
  rows = [];
fs.mkdirSync(dir, { recursive: true });
for (const input of ["utf8", "utf16", "tokens"])
  for (const loop of [
    "scalar",
    "unroll",
    "ascii8",
    "branchless",
    "high",
    "simd",
  ]) {
    if (
      (input !== "utf8" && loop === "ascii8") ||
      (loop === "simd" &&
        (input !== "tokens" || !process.argv.includes("--simd")))
    )
      continue;
    const name = input + "-" + loop,
      raw = path.join(dir, name + "-raw.wasm"),
      file = path.join(dir, name + ".wasm");
    execFileSync(
      "rustc",
      [
        "--edition=2021",
        "--crate-type=cdylib",
        "--target=wasm32v1-none",
        "-Copt-level=3",
        ...(loop === "simd" ? ["-Ctarget-feature=+simd128"] : []),
        "-Clto=fat",
        "-Ccodegen-units=1",
        "-Cpanic=abort",
        "-Cstrip=symbols",
        "-Clink-arg=-zstack-size=16384",
        "-Clink-arg=--import-memory",
        ...[
          ...(input === "utf16" ? ["utf16"] : []),
          ...(input === "tokens" ? ["tokens"] : []),
          ...(loop === "scalar" ? ["scalar"] : []),
          ...(loop === "ascii8" ? ["ascii8"] : []),
          ...(loop === "branchless" ? ["branchless"] : []),
          ...(loop === "high" ? ["high"] : []),
          ...(loop === "simd" ? ["simd"] : []),
        ].flatMap((f) => ["--cfg", f]),
        "benchmarks/fixtures/utf8-raw.rs",
        "-o",
        raw,
      ],
      { cwd: root, stdio: "inherit" },
    );
    execFileSync(
      path.join(root, "node_modules/.bin/wasm-opt"),
      [
        raw,
        "-O3",
        ...(loop === "simd" ? ["--enable-simd"] : []),
        "--converge",
        "--vacuum",
        "--zero-filled-memory",
        "--strip-producers",
        "-o",
        file,
      ],
      { stdio: "inherit" },
    );
    const bytes = fs.readFileSync(file);
    for (const copy of input === "utf16" ? [0, 1, 2] : [0]) {
      const variant = "wasm-" + name + (copy ? "-copy" + copy : ""),
        code = esbuild.buildSync({
          entryPoints: ["benchmarks/experiments/utf8-rival/wasm.mjs"],
          bundle: true,
          write: false,
          minify: true,
          format: "esm",
          target: "chrome109",
          define: {
            WASM_BYTES: JSON.stringify(bytes.toString("base64")),
            WASM_UTF16: String(input !== "utf8"),
            WASM_TOKENS: String(input === "tokens"),
            WASM_COPY: String(copy),
          },
        }).outputFiles[0].text;
      const module = path.join(dir, variant + ".mjs");
      fs.writeFileSync(module, code);
      rows.push({
        name: variant,
        file: path.relative(root, module),
        wasmBytes: bytes.length,
        moduleBytes: Buffer.byteLength(code),
        family: "utf8",
      });
    }
  }
fs.writeFileSync(
  path.join(dir, "builds.json"),
  JSON.stringify(rows, null, 2) + "\n",
);
console.log(JSON.stringify(rows));
