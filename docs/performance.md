# Performance

All retained datasets are public, deterministic fixtures. Results identify their
browser, architecture, implementation hashes and timing boundaries. They are
measurements on unpinned hosts, not cross-device guarantees.

## Decoder

The v0.2.1 SIMD change processes four complete BLAKE3 chunks in parallel, retaining
scalar tails and tree/root processing. The browser keeps native gzip/base64 and
typed-array transfers. JavaScript and Wasm both execute within V8.

On Chromium 156.0.8078.79 / ARM64, paired complete default-secure calls for random
1 MiB fell from 4.5 to 3.3 ms. The [local results](../benchmarks/results/v0.2.1/README.md)
retain five public fixtures and all twelve runtime choices. An independent x64
run on Chromium 153.0.8010.12 measured 4.5 to 3.1 ms for random 1 MiB.

A separate fresh Chromium 156 transport campaign measured 3.6 ms for default
GlyphPack versus 2.9 ms for native Base64 plus JS BLAKE3 on random 1 MiB. Each
campaign has its own environment and samples; do not combine its absolute times
with another campaign. Peer structural validation and hash implementations differ.

The full minified module is 12,087 bytes; core/none are 2,988 bytes. Default
verification remains format on, BLAKE3 on, and the heavy lookup off.

## Encoder

The encoder compares masks without allocating transformed inputs, shares scans
across four candidate carry chains, and writes directly to the selected UTF-16LE,
u16 or UTF-8 backend. Sampled search ranks deterministic prefix/suffix samples
before scoring the shortlist over the complete input. Exact search retains its
stable priority and tie-breaking.

[Public native measurements](../benchmarks/results/v0.2.0/encoder-comparison.csv)
and [browser encoder measurements](../benchmarks/results/v0.2.0/encoder-browser.json)
describe the previous optimization campaign. New encoder measurements will be
recorded separately; old numbers are not relabeled as new results.

## Reproduce

See [benchmarking](benchmarking.md) for commands and timing boundaries. Inputs
include pseudorandom bytes, zeros, sequential bytes, text and caller-selected
files. Encoding, input construction, module initialization and correctness
checks are outside decode timers. Complete encoder timers include the selected
hash, mask search and newly allocated output.

Inline standalone HTML works offline under `file://`; tests cover Chrome 109
and current Chromium with UTF-8 and UTF-16LE documents. No companion fetch or
file-access/web-security override is required.
