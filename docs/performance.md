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

The [v0.2.2 paired campaign](../benchmarks/results/v0.2.2/README.md) compares
complete encoding calls with frozen v0.2.1, using identical output bytes:

| Secure encoding | Before | After | Speedup |
| --- | ---: | ---: | ---: |
| Chromium 156 / ARM64, random 1 MiB, sampled | 36.3 ms | 15.9 ms | 2.28× |
| Chromium 156 / ARM64, random 1 MiB, exact | 175.3 ms | 125.5 ms | 1.40× |
| Native ARM64, random 1 MiB, exact | 101.54 ms | 98.10 ms | 1.04× |
| Opt-in native parallel, random 1 MiB, exact | 98.31 ms | 67.54 ms | 1.46× |

Native rows are separate process campaigns. The serial native improvement is
small and host-dependent. The optional parallel path helps expensive searches;
many inputs retain the serial path, and the feature stays off by default.
The independent GitHub x64 browser campaign measured 2.14× sampled and 1.37×
exact speedups on random 1 MiB with Chromium 153.0.8010.12. Its absolute times
are separate from the Chromium 156 campaign.

Browser improvements combine Rust mask scoring, output capacity reuse, native
UTF-16 conversion and existing SIMD BLAKE3. They are not an isolated measure of
Rust packing speed. The optional workbench encoder grows from 20,292 to 22,636
module bytes; all decoder modules and encoded payload bytes remain unchanged.
The reports retain all integrity modes, native representations and run ranges,
including slower cases, with seven representative rows in the compact CSV.

[Earlier public native measurements](../benchmarks/results/v0.2.0/encoder-comparison.csv)
and [browser measurements](../benchmarks/results/v0.2.0/encoder-browser.json)
remain a separately labeled campaign.

## Reproduce

See [benchmarking](benchmarking.md) for commands and timing boundaries. Inputs
include pseudorandom bytes, zeros, sequential bytes, text and caller-selected
files. Encoding, input construction, module initialization and correctness
checks are outside decode timers. Complete encoder timers include the selected
hash, mask search and output construction. Native calls allocate fresh outputs;
the browser retains Wasm capacity and produces an owned JavaScript string.

Inline standalone HTML works offline under `file://`; tests cover Chrome 109
and current Chromium with UTF-8 and UTF-16LE documents. No companion fetch or
file-access/web-security override is required.
