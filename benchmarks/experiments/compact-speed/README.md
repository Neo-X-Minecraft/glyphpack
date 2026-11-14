# Compact UTF-8 candidates

Own code: NeoX, 0BSD. These are retained experiments, not shipped backends.

- `encode.rs`: independent prefix-code and five-range ANS encoders.
- `decode.mjs`: JS Number/uint32 ANS and prefix-code decoders. Also the
  independent arithmetic oracle used by `tests/compact.cjs`.
- `wasm.rs`: trusted-fixture native candidates, comparing integer, floating and
  constant-32-bit quotients. Production code adds all input/policy guards.
- `host.mjs`: complete native staging, memory growth and owned output copy.
- `before-full.min.mjs`: exact full distribution before the replacement.

Prepare with `cargo run --release --locked --example compact_speed`. The JS
screen is `node benchmarks/compact-speed.cjs`. The original `screen.json` was
recorded before integration: its `utf8-compact` row is the old enumerative
baseline. Later reruns also label that representation explicitly as `legacy`.

Build the experimental Wasm, then run `node benchmarks/compact-wasm.cjs`:

```sh
rustc --edition 2021 --target wasm32v1-none --crate-type cdylib -O \
  -C opt-level=3 -C panic=abort -C link-arg=--import-memory \
  -C link-arg=--stack-first -C link-arg=-zstack-size=32768 \
  -o generated/compact-speed/decoder.wasm \
  benchmarks/experiments/compact-speed/wasm.rs
```

The selected production kernel is
`crates/decoder-wasm/src/utf8_compact.rs`; `src/utf8-compact/ans.rs` emits
new packets. Candidate body-only timings omit the final header adapter.
Use `node benchmarks/compact-final.cjs` for complete before/after calls with
format checks and each current integrity mode. Both full modules are warmed
with the same fast-path input mix to avoid unequal V8 string feedback. Its
three-process samples, exact module hashes and paired report live under
`benchmarks/results/compact-speed/`.

Rejected variants remain here for reproduction. The delivered new compact
backend is selected at build time and never runs a calibration benchmark.
