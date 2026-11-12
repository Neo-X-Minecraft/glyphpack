/* 0BSD, NeoX. Reconstruct the exact published control modules from Git, rather
 * than recompiling old code with today's compiler or adapter. */
const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process"),
  { gunzipSync } = require("node:zlib");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/optimization"),
  ref = process.argv[2] || "6214588";
if (!/^[a-zA-Z0-9._/-]+$/.test(ref)) throw Error("Expected a commit or tag");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "candidates.json"),
  manifest = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file))
    : { rows: [] };
manifest.rows = manifest.rows.filter((r) => r.variant !== "baseline");
for (const profile of ["recommended", "recommended-full", "full"]) {
  const source = execFileSync(
      "git",
      ["show", `${ref}:dist/${profile}.min.mjs`],
      { cwd: root, encoding: "utf8" },
    ),
    matches = [...source.matchAll(/["'](H4sI[A-Za-z0-9+/=]+)["']/g)];
  if (matches.length !== 1)
    throw Error("Expected exactly one embedded gzip member");
  const gzip = Buffer.from(matches[0][1], "base64"),
    wasm = gunzipSync(gzip),
    moduleFile = path.join(dir, profile + "-baseline.mjs"),
    wasmFile = path.join(dir, profile + "-baseline.wasm");
  if (
    fs.existsSync(moduleFile) &&
    fs.readFileSync(moduleFile, "utf8") !== source
  )
    throw Error("An existing baseline differs from the Git control");
  fs.writeFileSync(moduleFile, source);
  fs.writeFileSync(wasmFile, wasm);
  manifest.rows.push({
    profile,
    variant: "baseline",
    module: path.relative(root, moduleFile),
    wasm: path.relative(root, wasmFile),
    moduleBytes: Buffer.byteLength(source),
    wasmBytes: wasm.length,
    gzipBytes: gzip.length,
  });
}
manifest.baselineCommit = ref;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
