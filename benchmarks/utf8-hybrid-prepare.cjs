/* 0BSD, NeoX. Rust compiles kernels and externref ABI adaptation; JS orchestrates
 * builds, gzip size comparisons and browser-bundle specialization. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { execFileSync } = require("node:child_process"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/utf8-hybrid"),
  dest = path.join(root, "generated/utf8-speed"),
  rows = [],
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  family = (
    process.argv.find((a) => a.startsWith("--only=")) || "--only=all"
  ).slice(7);
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(dest, { recursive: true });
function kernel(name, input, kind, flags = []) {
  const raw = path.join(dir, name + "-raw.wasm"),
    opt = path.join(dir, name + "-opt.wasm"),
    file = path.join(dir, name + ".wasm"),
    string = input === "jsstring";
  execFileSync(
    "rustc",
    [
      "--edition=2021",
      "--crate-type=cdylib",
      "--target=wasm32v1-none",
      "-Copt-level=3",
      "-Clto=fat",
      "-Ccodegen-units=1",
      "-Cpanic=abort",
      "-Cstrip=symbols",
      "-Clink-arg=-zstack-size=16384",
      ...(kind === "stateless" ? ["-Clink-arg=--import-memory"] : []),
      "--cfg",
      "input_" + input,
      ...flags.flatMap((f) => ["--cfg", f]),
      path.join(
        root,
        "benchmarks/fixtures/utf8-hybrid" +
          (kind === "stateless" ? "-stateless" : "") +
          ".rs",
      ),
      "-o",
      raw,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    process.env.WASM_OPT || path.join(root, "node_modules/.bin/wasm-opt"),
    [
      raw,
      "-O3",
      "--converge",
      "--vacuum",
      "--strip-dwarf",
      "--strip-producers",
      "-o",
      string ? opt : file,
    ],
    { stdio: "inherit" },
  );
  if (string)
    execFileSync(path.join(dir, "string-types"), [opt, file], {
      stdio: "inherit",
    });
  return fs.readFileSync(file);
}
function emit(name, input, kind, loop, chunk, bytes, prime = 0) {
  const gz = execFileSync("gzip", ["-9nc"], { input: bytes }),
    r = {
      name,
      input,
      kind,
      loop,
      chunk,
      prime,
      wasmBytes: bytes.length,
      gzipWasmBytes: gz.length,
      wasmSha256: sha(bytes),
    };
  for (const gzip of [false, true]) {
    const code = esbuild.buildSync({
      entryPoints: [
        path.join(
          root,
          "benchmarks/experiments/utf8/hybrid" +
            (kind === "stateless" ? "-stateless" : "") +
            ".mjs",
        ),
      ],
      bundle: true,
      write: false,
      minify: true,
      format: "esm",
      target: "chrome109",
      define: {
        PREFIX_PORTABLE_ONLY: "true",
        HYBRID_INPUT: JSON.stringify(input),
        HYBRID_FSM: String(loop === "fsm"),
        HYBRID_CHUNK: String(chunk),
        HYBRID_PRIME: String(prime),
        HYBRID_GZIP: String(gzip),
        HYBRID_BINARY: JSON.stringify((gzip ? gz : bytes).toString("base64")),
      },
    }).outputFiles[0].text;
    fs.writeFileSync(
      path.join(dest, name + (gzip ? "-gzip" : "") + ".custom.mjs"),
      code,
    );
    if (
      !gzip &&
      ["stateless-utf8-high", "stateless-words-scalar"].includes(name)
    )
      fs.writeFileSync(
        path.join(
          dir,
          name === "stateless-utf8-high"
            ? "decoder-hybrid.min.mjs"
            : "decoder-words.min.mjs",
        ),
        code,
      );
    if (gzip) {
      r.gzipModuleBytes = Buffer.byteLength(code);
      r.gzipModuleSha256 = sha(code);
    } else {
      r.moduleBytes = Buffer.byteLength(code);
      r.moduleSha256 = sha(code);
    }
  }
  rows.push(r);
}
if (["all", "state"].includes(family))
  for (const input of ["utf8", "utf16", "words", "tokens"])
    for (const loop of ["scalar", "high", "block8"]) {
      const stem = input + "-" + loop,
        bytes = kernel(
          stem,
          input,
          "state",
          loop === "high"
            ? ["queue_high"]
            : loop === "block8"
              ? ["block8"]
              : [],
        );
      for (const chunk of [0, 4096, 32768])
        emit(
          "hybrid-" + stem + (chunk ? "-" + chunk : ""),
          input,
          "state",
          loop,
          chunk,
          bytes,
        );
    }
if (["all", "stateless"].includes(family)) {
  for (const input of ["utf8", "utf16", "words"])
    for (const loop of ["scalar", "high"]) {
      const name = "stateless-" + input + "-" + loop,
        bytes = kernel(
          name,
          input,
          "stateless",
          loop === "high" ? ["queue_high"] : [],
        );
      emit(name, input, "stateless", loop, 0, bytes);
    }
  const bytes = kernel("stateless-utf16-fsm", "utf16", "stateless", ["fsm"]);
  emit("stateless-utf16-fsm", "utf16", "stateless", "fsm", 0, bytes);
  for (const input of ["utf16", "words"]) {
    const name = "bulk-" + input,
      bytes = kernel(name, input, "stateless", ["block8"]);
    emit(name, input, "stateless", "block8", 0, bytes);
  }
}
if (["all", "strings"].includes(family)) {
  execFileSync(
    "rustc",
    [
      "-O",
      "--edition=2021",
      path.join(root, "benchmarks/fixtures/wasm-string-types.rs"),
      "-o",
      path.join(dir, "string-types"),
    ],
    { stdio: "inherit" },
  );
  for (const loop of [
    "scalar",
    "high",
    "length",
    "length-high",
    "cast",
    "cast-high",
  ]) {
    const name = "string-" + loop,
      bytes = kernel(name, "jsstring", "stateless", [
        ...(loop.includes("high") ? ["queue_high"] : []),
        ...(loop.includes("length") ? ["string_length"] : []),
        ...(loop.includes("cast") ? ["string_cast"] : []),
      ]);
    emit(name, "jsstring", "stateless", loop, 0, bytes);
    if (loop === "length")
      emit(
        "string-prime-32768",
        "jsstring",
        "stateless",
        loop,
        0,
        bytes,
        32768,
      );
  }
}
fs.writeFileSync(
  path.join(dir, "builds" + (family === "all" ? "" : "-" + family) + ".json"),
  JSON.stringify(rows, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    builds: rows.length,
    smallestCore: Math.min(...rows.map((r) => r.wasmBytes)),
    largestCore: Math.max(...rows.map((r) => r.wasmBytes)),
  }),
);
