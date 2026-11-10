# Optimization archive

`snapshots/` preserves the JavaScript candidate implementations from the prior
store, batching, high-digit and state-machine experiments. Original measured
reports are under `../results/`. The archive is excluded from production builds.

- `stores/`: DataView, byte-write and aligned-word alternatives.
- `small-stores/`: isolated size/adaptive store candidates.
- `patterns/`: unrolling, state transitions, bounds and pattern-specific paths.
- `high-digits/`: precomputed high-digit layouts and invalid-symbol sentinels.
- `guide/`: earlier control-flow and validation rearrangements.

These frozen files retain their historical algorithms and measurements. The
active decoder source is `src/decoder/`; current Rust build logic is
`src/builder.rs`. Use the current benchmark for measurements on new inputs.

Fresh local rechecks of the complete optimization archive are documented in
[historical rechecks](../../docs/historical-recheck.md).
