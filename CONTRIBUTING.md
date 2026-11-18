# Contributing

Own code is 0BSD, attributed to NeoX. Keep third-party notices separate.

1.0.0 is a clean payload/API baseline. Implement only current formats. Do not
add readers, emitters, aliases or fallback branches for unreleased experiments.
Future compatibility work considers published release formats only. Historical
measurements may remain as data, without executable copies of retired codecs.

Use Rust for native tooling and native kernels, JS for browser adapters/tests.
Folder names are lowercase. Edit authoritative sources and regenerate dist.
Do not weaken mandatory length, capacity, trailer or state bounds.

```sh
npm ci
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
npm test
npm run build
npm run test:types
npm run test:package
npm run test:examples
npm run test:integration
```

Performance tests compare complete current decode calls, matching data and
verification policies. Encode/import/warm-up/correctness checks stay outside
timers. Rotate order, consume outputs and report repeated measurements with
exact artifacts and browser versions. Chrome 109 is the compatibility baseline;
Chromium 156 is the recorded performance runtime.

Encode/inject/version must work outside the checkout. Build tooling discovers
sources at runtime, with GLYPHPACK_ROOT as explicit override. Local preparation
must not publish a tag, package, release or site without user authorization.
