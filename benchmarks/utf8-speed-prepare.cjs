/* 0BSD, NeoX. Reproduce the decoder search without private fixtures. JS only
 * orchestrates builds; native encoding/preparation lives in the Rust example. */
const fs = require("node:fs"),
  crypto = require("node:crypto"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/utf8-speed"),
  source = "benchmarks/experiments/utf8/";
fs.mkdirSync(dir, { recursive: true });
if (
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, source, "speed/baseline.min.mjs")))
    .digest("hex") !==
  "01e770988d9ec29a82339a17443198e9e723264409b826c1fdc25078ac961297"
)
  throw Error(
    "Historical baseline changed; do not reformat generated comparison code",
  );
fs.copyFileSync(
  path.join(root, source, "speed/baseline.min.mjs"),
  path.join(dir, "before.mjs"),
);
// Each model is a frozen research candidate. Only prefix.mjs + prefix-split.mjs
// are delivered; the extra prototype tables/loaders never enter that bundle.
for (const [name, loop, model] of [
  ["delivered", "prefix-throughput", "prefix"],
  ["balanced", "prefix-split", "prefix"],
  ["compactDirect", "speed/direct", "speed/model-wide"],
  ["smallest", "speed/smallest", "speed/model-wide"],
  ["narrow", "speed/narrow", "speed/model-narrow"],
  ["splitModel", "speed/split", "speed/model-split"],
]) {
  const code = esbuild.buildSync({
    stdin: {
      contents: `export {binary as decode} from './${source}${loop}.mjs';export {warmup} from './${source}${model}.mjs';`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: "esm",
    minify: true,
    target: "chrome109",
    define: { PREFIX_PORTABLE_ONLY: "true" },
  }).outputFiles[0].text;
  fs.writeFileSync(path.join(dir, name + ".custom.mjs"), code);
}
if (process.argv.includes("--wasm") || process.argv.includes("--simd")) {
  for (const [name, fixture, simd] of [
    ["wasmBytes", "bytes", false],
    ...(process.argv.includes("--simd") ? [["wasmSimd", "simd", true]] : []),
  ]) {
    const raw = path.join(dir, fixture + "-raw.wasm"),
      wasm = path.join(dir, fixture + ".wasm");
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
        "-Clink-arg=-zstack-size=65536",
        ...(simd ? ["-Ctarget-feature=+simd128"] : []),
        path.join(root, `benchmarks/fixtures/utf8-prefix-${fixture}.rs`),
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
        ...(simd ? ["--enable-simd"] : []),
        "-o",
        wasm,
      ],
      { stdio: "inherit" },
    );
    const code = esbuild.buildSync({
      entryPoints: [path.join(root, source, "speed/wasm.mjs")],
      bundle: true,
      write: false,
      format: "esm",
      minify: true,
      target: "chrome109",
      define: {
        PREFIX_PORTABLE_ONLY: "true",
        UTF8_KERNEL_BASE64: JSON.stringify(
          fs.readFileSync(wasm).toString("base64"),
        ),
      },
    }).outputFiles[0].text;
    fs.writeFileSync(path.join(dir, name + ".custom.mjs"), code);
  }
}
