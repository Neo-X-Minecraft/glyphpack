# Hybrid experiments

0BSD, NeoX. Source lives immediately above this directory; native kernels and
the trusted-compiler ABI adapter live in `benchmarks/fixtures/`. Nothing here
changes the npm exports or default prefix builds.

- `../hybrid.mjs` + `utf8-hybrid.rs`: stateful kernels with whole/4/32 KiB input
  staging, four input representations and three packing loops.
- `../hybrid-stateless.mjs` + `utf8-hybrid-stateless.rs`: imported memory with
  one native call; copied UTF-8/UTF-16, translated words, finite-state table,
  tighter bulk loops and native JS string builtins.
- `wasm-string-types.rs`: native Rust adapter for these known string kernels.
  An opaque i64 ABI keeps LLVM's string handle in its own register class. After
  optimization the adapter changes its parameter/local types to externref and
  the builtin cast result to a nonnull external reference. It does not alter
  instructions or constants. It is not a general arbitrary-Wasm converter.
- `benchmarks/utf8-hybrid-prepare.cjs`: invokes Rust/Binaryen/native gzip,
  specializes JS glue and records complete raw/gzip bundle sizes and hashes.
- `benchmarks/utf8-hybrid-cold.cjs`: fresh process for each first-use sample.
- `benchmarks/utf8-hybrid-verify.cjs`: real offline HTML with embedded modules,
  fallback, ownership, gzip and malformed long inputs at transfer boundaries.
- `benchmarks/utf8-hybrid-report.cjs`: checks exact artifact hashes and writes
  the four-row comparison plus complete warm, cold, size and raw sample CSVs.

Use the standard fixture preparation in the parent README first. Then:

```sh
source .tools/env.sh
node benchmarks/utf8-speed-prepare.cjs
node benchmarks/utf8-hybrid-prepare.cjs

# Ordinary matrix: exclude eager priming so identical Wasm modules cannot
# prime one another through the browser's compilation cache.
SPEED_VARIANTS="$(node -e 'console.log(["delivered","balanced",...require("./generated/utf8-hybrid/builds.json").filter(r=>!r.prime&&!r.name.startsWith("string-cast")).map(r=>r.name)].join(","))')" SPEED_ALLOW_FALLBACK=1 SPEED_OUT=benchmarks/results/utf8-hybrid SPEED_LABEL=all node benchmarks/utf8-speed.cjs

# Selected matched campaign, three fresh processes per target browser.
SPEED_VARIANTS=delivered,balanced,hybrid-words-scalar-4096,hybrid-words-high-4096,stateless-words-scalar,stateless-utf8-high,string-length SPEED_ALLOW_FALLBACK=1 SPEED_OUT=benchmarks/results/utf8-hybrid SPEED_LABEL=selected SPEED_RUNS=3 SPEED_ROUNDS=9 node benchmarks/utf8-speed.cjs

# Priming and engine-flag diagnostics run separately from ordinary measurements.
SPEED_VARIANTS=delivered,string-prime-32768 SPEED_ALLOW_FALLBACK=1 SPEED_OUT=benchmarks/results/utf8-hybrid SPEED_LABEL=prime node benchmarks/utf8-speed.cjs
SPEED_VARIANTS=delivered,string-length SPEED_ALLOW_FALLBACK=1 SPEED_BROWSER_ARGS='["--js-flags=--no-liftoff"]' SPEED_OUT=benchmarks/results/utf8-hybrid SPEED_LABEL=optimizing-only node benchmarks/utf8-speed.cjs

HYBRID_COLD_VARIANTS=delivered,balanced,hybrid-utf8-high,stateless-utf8-high node benchmarks/utf8-hybrid-cold.cjs
node benchmarks/utf8-hybrid-verify.cjs
```

The recorded final matrix was split across `all.json` (49 ordinary hybrids) and
`cast.json` (the final two string-cast variants). Reproduce that latter phase
before running the report:

```sh
SPEED_VARIANTS=delivered,balanced,string-cast,string-cast-high SPEED_ALLOW_FALLBACK=1 SPEED_OUT=benchmarks/results/utf8-hybrid SPEED_LABEL=cast node benchmarks/utf8-speed.cjs
node benchmarks/utf8-hybrid-report.cjs
```

`--only=state`, `--only=stateless`, or `--only=strings` prepares a family when
iterating. A complete preparation also creates `decoder-hybrid.min.mjs` and
`decoder-words.min.mjs` under `generated/utf8-hybrid/`. They contain embedded
Wasm and a JS fallback; no runtime fetch or separate Wasm file is required.

Compiler output, payloads and HTML stay in ignored `generated/`. Only public
synthetic fixture descriptions, hashes and measurements are committed. The
main [report](../../../../docs/utf8-hybrid.md) explains the workload tradeoffs.
