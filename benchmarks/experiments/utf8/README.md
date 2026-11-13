# UTF-8 arithmetic packing experiment

0BSD, NeoX. This is research, excluded from browser distributions and npm exports.
It adds no production codec, payload identifier or public API.

`reference/codec.mjs` and `reference/arithmetic.mjs` are the original complete
source-appendix implementations supplied for review. Their arithmetic format
is intentionally unchanged. `reference/fixtures.mjs` and `reference/test.mjs`
retain that appendix's tests; the test harness removes workspace fallback paths
and redirects generated output outside the source tree.

The document's ending describes `dense.mjs` and `dense-small.mjs` but does not
include their source. `dense-browser.mjs` is an independent reconstruction of
the described browser strategy, with in-place guard/NUL handling, direct scalar
mapping, an ASCII path, unsigned interval updates and grouped pending-one writes.
Its measurements must not be attributed to those missing implementations.

```sh
# Load the repository tool environment first if needed.
source .tools/env.sh
node benchmarks/experiments/utf8/verify.mjs
CHROMIUM_BIN=/usr/bin/chromium node benchmarks/experiments/utf8/reference/test.mjs
CHROMIUM_BIN=.tools/chromium109/chromium node benchmarks/experiments/utf8/reference/test.mjs
cargo run --release --locked -- bench prepare
node benchmarks/utf8-proposal.cjs
node benchmarks/utf8-proposal-summary.cjs
```

`UTF8_RUNS` and `UTF8_ROUNDS` configure the comparison; defaults are three fresh
processes per browser and five measured batches. `CHROMIUM_BIN` and
`CHROMIUM109_BIN` select browser executables. Node/Wasm peer encoding fixtures
are prepared outside timers. The reference JavaScript encoders are kept here
only to preserve and assess the supplied research, not as native library code.

See [the review](../../../docs/utf8-proposal.md) for density, speed, compatibility,
the difference between HTML and general text channels, and integration advice.

## Fast prefix transport

The newer [prefix transport](../../../docs/utf8-prefix.md) uses a different wire
format to remove the per-bit arithmetic loop. It is usable through the native
`utf8_prefix` example's `encode`, `build` and `html` commands. None of these
changes the current GlyphPack wire format or verification defaults.

- `prefix.mjs`: header parsing, fixed alphabets, allocation guards, table warm-up
  and the original scalar prefix candidate. Profile 5 is portable/NFC-stable;
  profile 4 favors literal compactness; 0..3 are intermediate studies.
- `prefix-throughput.mjs`: default high-aligned queue and speculative stores.
- `prefix-split.mjs`: balanced loop, selected at build time with `--balanced`.
- `prefix-fast.mjs`, `prefix-branch.mjs`, `prefix-block-validated.mjs` and
  `prefix-deferred.mjs`: measured alternatives, excluded from delivered builds.
- `examples/utf8_prefix.rs`: optimized native encoder, masking, fixture generation,
  build command and self-contained HTML creation. All authored code is 0BSD.
- `benchmarks/fixtures/utf8-prefix.rs`: benchmark-only Wasm kernel; not shipped.
- `speed/`: the newer [19-variant optimization study](../../../docs/utf8-speed.md),
  its frozen models, exact historical baseline and reproduction commands.
- `hybrid/`: the follow-up [JS/Wasm study](../../../docs/utf8-hybrid.md), with
  native-copy, translated-word, stateless and direct-string configurations.

```sh
cargo run --release --locked -- bench prepare
cargo run --release --locked --example utf8_prefix
cargo run --release --locked --example utf8_prefix -- build generated/utf8-prefix/decoder.min.mjs
cargo run --release --locked --example utf8_prefix -- build generated/utf8-prefix/decoder-balanced.min.mjs --balanced
cargo run --release --locked --example utf8_prefix -- build generated/utf8-prefix/decoder-full.min.mjs --all-profiles
cargo run --release --locked --example utf8_prefix -- build generated/utf8-prefix/decoder.iife.js --classic
cargo run --release --locked --example utf8_prefix -- html generated/encoding-comparison/random-1MiB.bin generated/utf8-prefix/example.html
node benchmarks/utf8-prefix-compat.cjs
rustc --edition=2021 --crate-type=cdylib --target=wasm32v1-none -Copt-level=3 -Clto=fat -Ccodegen-units=1 -Cpanic=abort -Cstrip=symbols -Clink-arg=-zstack-size=65536 benchmarks/fixtures/utf8-prefix.rs -o generated/utf8-prefix/raw.wasm
node_modules/.bin/wasm-opt generated/utf8-prefix/raw.wasm -O3 --converge --vacuum --strip-dwarf --strip-producers -o generated/utf8-prefix/kernel.wasm
PREFIX_LABEL=screen node benchmarks/utf8-prefix.cjs
PREFIX_COMPARE=1 PREFIX_LABEL=final node benchmarks/utf8-prefix.cjs
node benchmarks/utf8-prefix-report.cjs
```

For the optional 10 MiB navigation check, compile and run
`benchmarks/fixtures/utf8-prefix-large.rs` with `rustc -O`, then use the native
`html` command on `generated/utf8-prefix/large.bin`, writing `large.html` in the
same directory. The compatibility runner includes it automatically if present.

`PREFIX_RUNS` and `PREFIX_ROUNDS` control the number of fresh processes and
batches. Defaults are three and nine. The comparison includes native Base64,
five Base122 implementations and the earlier arithmetic candidate. Each input
is hash-checked before timing. Packet strings and public fixture files stay in
the ignored `generated/` directory; only aggregate/raw timing records are kept.
