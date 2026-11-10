# Decoder experiments retained as evidence

These candidates were rejected for v0.2.0; the production decoder loop stays
unchanged. Run `bench prepare`, build a candidate with `build --full`, and use:

```sh
node benchmarks/compare.cjs before.mjs after.mjs generated/results/paired.json
```

The paired harness checks output bytes and buffer shape, then measures all 12
settings across five datasets in three fresh Chromium processes. It alternates
implementation order, excludes three warm-up rounds, and retains nine measured
batches per configuration. It writes raw samples and a compact comparison CSV.
The browser version is checked against `benchmarks/chromium.json`; use an explicit
`CHROMIUM_VERSION` override for another browser.

On the local ARM64 / Chromium 156 host:

- A fixed `[u16; 65536]` table type generated exactly the same Wasm and ESM.
  LLVM had already eliminated the table bounds checks.
- `branchless.patch` preserved 60,850 byte/error/buffer comparisons. It reduced
  the full module from 9,403 to 9,207 bytes, but the paired geometric speed ratio
  was about 0.95 for no integrity, 0.96 for XXH32 and 1.00 for BLAKE3. A ratio
  below 1 is slower. The size saving did not justify that tradeoff.

These are local experiments with uncontrolled CPU frequency and scheduling,
not universal engine claims. The patch is test material, not a runtime path.
