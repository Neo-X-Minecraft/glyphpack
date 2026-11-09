These are test-only sources, pinned by commit and SHA-256 in
`benchmarks/vendor/sources.json`. They are not shipped in the production
payload codec. Original license files are retained beside the sources.

- Kevin Albertson's [Base122](https://github.com/kevinAlbs/Base122), MIT.
  The browser byte-decoding core is extracted for the benchmark. DOM lookup,
  Blob creation and URL publication are omitted, and its result is returned as a
  correctly trimmed Uint8Array view. Upstream files remain unmodified.
- [code4fukui/Base122](https://github.com/code4fukui/Base122), MIT.
  Browser-native Uint8Array fork; also the independent encoder cross-check.
- [Sheep-y/Base85](https://github.com/Sheep-y/Base85), Apache-2.0.
  Both Ascii85 and Z85-alphabet byte-decoding APIs are screened.
- [AlttiRi/base85](https://github.com/AlttiRi/base85), MIT.
  Both Ascii85 and Z85-alphabet byte-decoding APIs are screened.

Local alternatives are explicitly labeled in
`benchmarks/fixtures/encoding-competitors.js`. Base121 here is a local Base122
extension excluding `<`, not a claim of compatibility with a published Base121
standard. The Base85 fixtures omit z/y shortcuts and use partial-block padding;
the Z85 alphabet variant therefore accepts lengths beyond strict ZeroMQ Z85.

Selection means the fastest correct candidate among these tests, not a claim to
have proven the globally fastest implementation. Native Rust/Java throughput
claims are not used as browser JavaScript measurements.
