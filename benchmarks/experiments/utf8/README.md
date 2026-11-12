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
