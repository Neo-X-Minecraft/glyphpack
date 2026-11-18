# Local packing comparison

Production remains unchanged. These are alternative wire formats and specialized experimental decoder builds, not a migration. Every final timing compares complete calls with the same verification policy and fresh owned output.

[Decision CSV](decision.csv) · [All final timings](timings.csv) · [All source sizes](sizes.csv) · [Cold runs](cold.csv)

## 10 MiB random input, secure verification

Source includes framing, BLAKE3 and contextual escapes. HTML includes the actual inlined decoder, native gzip/base64 loader, escaping helper, charset declaration and BOM where appropriate. Warm times are medians of three independent process medians, in milliseconds.

| Codec | Source bytes | Complete HTML bytes | HTML overhead | Warm 156 | Warm 109 | Cold ready 156 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| r254-group64-wasm16 | 10505965 | 10518239 | 0.3097% | 49.00 | 52.40 | 685.8 |
| r254-ans4-wasm16 | 10500835 | 10514197 | 0.2712% | 51.80 | 53.80 | 701.8 |
| r253-ans4-wasm16 | 10508299 | 10521487 | 0.3407% | 58.30 | 53.90 | 614.5 |
| wide-ans16x4precise-wasm16 | 10515982 | 10539280 | 0.5104% | 40.20 | 34.60 | 311.5 |
| wide-wasm | 10526358 | 10548130 | 0.5948% | 38.10 | 35.00 | 293.5 |
| base64-native | 13981056 | 13988936 | 33.4089% | 24.10 | 158.60 | 468.3 |
| production | 10528066 | 10553510 | 0.6461% | 41.40 | 35.40 | 240.6 |

## Matched 1 MiB random input on Chromium 156

| Codec | None (ms) | xxHash32 (ms) | BLAKE3 (ms) |
| --- | ---: | ---: | ---: |
| r254-group64-wasm16 | 4.000 | 4.100 | 5.700 |
| r254-ans4-wasm16 | 4.100 | 4.300 | 5.900 |
| r253-ans4-wasm16 | 4.200 | 4.400 | 5.400 |
| wide-ans16x4precise-wasm16 | 2.300 | 2.600 | 4.100 |
| wide-wasm | 2.500 | 2.800 | 4.200 |
| base64-native | 1.150 | 1.500 | 2.900 |
| production | 2.500 | 2.600 | 4.200 |

## Cold file loads

Fresh browser/profile for each file; three runs per browser. Ready includes the actual file read, charset decoding, parsing, template restoration, gzip/base64 loading, Wasm instantiation and first verified decode. Browser launch and the independent SHA-256 comparison are excluded. The OS file cache may be warm. These descriptive ranges are not confidence intervals.

| Codec | Input | 156 ready median [min, max] ms | 109 ready median [min, max] ms |
| --- | --- | ---: | ---: |
| r254-group64-wasm16 | random-1KiB | 36.3 [35.6, 54.7] | 55.7 [42.8, 72.8] |
| r254-group64-wasm16 | random-1MiB | 131.5 [113.4, 150.4] | 151.3 [139.1, 185.3] |
| r254-group64-wasm16 | random-10MiB | 685.8 [680.1, 687.5] | 667.6 [659.0, 674.9] |
| r254-ans4-wasm16 | random-1KiB | 43.4 [33.8, 47.8] | 62.1 [43.6, 71.2] |
| r254-ans4-wasm16 | random-1MiB | 125.9 [123.9, 133.0] | 155.9 [153.6, 158.9] |
| r254-ans4-wasm16 | random-10MiB | 701.8 [639.3, 703.2] | 742.1 [697.3, 743.2] |
| r253-ans4-wasm16 | random-1KiB | 50.6 [42.5, 54.0] | 64.3 [61.9, 99.1] |
| r253-ans4-wasm16 | random-1MiB | 131.1 [129.5, 151.5] | 142.3 [126.0, 142.8] |
| r253-ans4-wasm16 | random-10MiB | 614.5 [607.0, 694.3] | 687.7 [682.1, 693.6] |
| wide-ans16x4precise-wasm16 | random-1KiB | 55.0 [44.7, 56.1] | 65.6 [58.7, 70.5] |
| wide-ans16x4precise-wasm16 | random-1MiB | 86.9 [75.7, 99.6] | 85.6 [76.1, 94.9] |
| wide-ans16x4precise-wasm16 | random-10MiB | 311.5 [301.5, 319.8] | 353.9 [346.2, 370.0] |
| wide-wasm | random-1KiB | 47.1 [41.0, 53.2] | 53.7 [40.9, 75.2] |
| wide-wasm | random-1MiB | 74.8 [71.0, 80.5] | 95.8 [94.6, 96.7] |
| wide-wasm | random-10MiB | 293.5 [287.1, 308.0] | 354.9 [328.2, 374.1] |
| base64-native | random-1KiB | 48.3 [47.7, 50.2] | 60.1 [26.4, 77.0] |
| base64-native | random-1MiB | 96.6 [90.5, 98.5] | 130.4 [125.8, 134.0] |
| base64-native | random-10MiB | 468.3 [454.5, 473.8] | 622.4 [620.7, 653.7] |
| production | random-1KiB | 56.4 [39.6, 57.5] | 59.6 [54.0, 70.5] |
| production | random-1MiB | 74.4 [73.7, 78.9] | 102.0 [92.2, 114.3] |
| production | random-10MiB | 240.6 [224.4, 246.6] | 234.5 [234.1, 248.7] |

## Recommendation

Keep the current UTF-16 raw-script packaging as the default for fast standalone
startup. On 10 MiB random input, its verified page is ready in 241 ms on 156 and
235 ms on 109. The smallest Windows-1252 raw-tag/ANS build takes 702/742 ms while
saving 27,231 payload-source bytes (0.260% of input) and 39,313 complete-file
bytes in these actual builds. That is a useful **optional size profile**, not a
good unconditional replacement for a performance-oriented default.

If template-literal storage is required, the widened UTF-16 word-ANS candidate
is the strongest density/speed compromise tested: 12,084 fewer source bytes than
current packing at 10 MiB, with overlapping warm decode ranges, but its measured
full-page startup is still slower (312/354 ms). The wider pair-based template
starts slightly faster on 156 (294 ms), but saves only 1,708 source bytes in this
limited-mask experiment. None of these small file-size improvements warrants
quietly replacing an existing wire format; introduce a versioned opt-in profile
if one is adopted.

These recommendations use end-to-end startup as well as warmed calls. Native
Base64 wins warmed decoding on 156 but inflates the uncompressed standalone to
13.99 MB and loses startup here; its 109 `atob` fallback is much slower. The
Windows-1252 charset requirement also narrows how files may be hosted. Results
for compressed text, structured and repetitive inputs are in the full matrices;
the random example is not a universal worst-case or a proven global minimum.

## Scope and interpretation

All candidates keep the production xxHash32 and SIMD BLAKE3 sources unchanged.
Secure means an unkeyed BLAKE3 digest of the decoded bytes. It is integrity
checking, not authentication of an attacker-controlled packet and digest.
The final comparison uses three fresh processes, three warm-up rounds and nine
measured rounds per process on Chromium 156.0.8078.79 and Chrome 109.0.5414.119.
Sample order rotates. Every result is checked against an independent SHA-256
outside timing. Batch averages and run ranges are retained in the CSV and JSON.
The machine is ARM64, with unpinned scheduling, clocks and garbage collection;
the results are measurements on this host, not guarantees for every device.
The steady suite uses a fresh page with one resident packet/module per case;
codec order rotates between cases and processes. The older exploratory screen
instead interleaves calls on several resident packets. Its numbers are kept
separate. Large DevTools transfers were abandoned after a renderer termination;
the replacement loads inputs over loopback outside timing, and actual offline
HTML is checked independently by the cold suite.

Eleven corpora cover random 1 KiB/64 KiB/1 MiB/10 MiB, zero/FF/sequential bytes,
synthetic JSON logs, gzipped logs, UTF-8 text and the public decoder Wasm.
Empty and short packets are included in correctness checks. Alternate encoders
try masks 0 and 255; production uses its full default search. This is not an
exhaustive minimum-size search for every alternate format. Source sizes include
the selected trailer; decoder size and enclosing HTML are counted separately.

Validation passed for 11,040 valid short packets, 160 stale-digest rejections and
32,280 short-header rejections across both browsers, plus surrogate alias
controls. The final warm matrix contains 1,386 independently checked cases and
12,474 measured batch samples; the cold suite has 126 offline file loads and
the HTTP charset suite has 42 cases, including six expected UTF-8-header failures.

`final-156.json` and `final-109.json` contain raw final samples and exact module
hashes. `screen.json`, `wide-screen.json` and `utf8-screen.json` are exploratory
one-process screens of the larger candidate matrix, deliberately excluded from
the final medians. `correctness.json` records valid packets, deliberately stale
digests and short-header rejection for all 40 modules in both actual browsers.
Surrogate aliases of the intentional replacement-character digit are rejected.
`protocol.json` records correct, absent and deliberately wrong HTTP charsets.
Wasm memory is retained linear-memory capacity after a call, not peak total
memory; production does not expose that metric.
The production baseline uses the full runtime; alternate kernels specialize
their transport and always verify format. Complete HTML sizes describe those
actual builds, not a globally minimized secure-only runtime. Payload-source
sizes isolate the packing change from decoder specialization.
`gzip9_html_bytes` is a whole-document HTTP-transfer diagnostic using native
gzip `-9 -n`; it is not a gzip file masquerading as directly openable HTML.
The measured standalone files are ordinary uncompressed HTML. Only their
embedded Wasm loader uses gzip/base64 with native `DecompressionStream`.

## Formats and browser constraints

The UTF-16 alternatives use 63,484 BMP symbols: exclude NUL, CR, backslash,
backtick and surrogates. Contextual escapes preserve literal values while
breaking `${`, case-insensitive `</script` prefixes and `<!--`. Dangerous
combinations are always escaped; safety does not depend on their probability.
The earlier [vocabulary parser suite](../../template-literals/results/RESULTS.md)
covers all 65,536 units, slash runs and delimiter/control edge cases.

Windows-1252 uses one source byte per symbol. The cooked-template candidate has
253 symbols; the raw-tag candidate has 254, adding ordinary backslash. Both
exclude CR and backtick. Raw-tag marker escaping is reversible, including
existing marker lookalikes and trailing slashes. Source NUL becomes U+FFFD in
HTML script data; that unique result is intentionally the zero-byte digit.
The source must declare `windows-1252` and have no UTF-8 BOM. The actual files
pass under `file://` and HTTP with correct or absent HTTP charset. A conflicting
UTF-8 HTTP header breaks them. UTF-16 BOMs survive that conflicting header in
these tests. Windows-1252 HTML is not a drop-in external UTF-8 JavaScript module.

The interleaved ANS variants use a uniform model as a radix conversion, not an
adaptive compressor. Four independent state chains expose more parallelism.
Byte output radix 254 approaches its asymptotic 0.1416% information bound, plus
headers, states, finite-precision losses and source escapes. The precise UTF-16
word variant has 47-bit states and processes two input bytes per step. State
headers, terminal states, body bounds, padding and trailer checks are mandatory.
This is a new wire format, not a transparent alphabet change.

The 703-bit multi-limb conversion is close in density but far slower in the
screening run. A native `TextEncoder.encodeInto` bridge followed by UTF-8 parsing
in Wasm also lost substantially to copying UTF-16 code units. Neither is a
finalist. Pure JavaScript and preconverted-byte Wasm bridges are retained in the
exploratory results rather than being silently compared with faster finalists.

Concept references: [Duda's ANS paper](https://arxiv.org/abs/1311.2540),
[Giesen's byte rANS reference](https://github.com/rygorous/ryg_rans/blob/master/rans_byte.h),
[WHATWG encoding](https://encoding.spec.whatwg.org/),
[HTML script restrictions](https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements).
The experiment implements the radix converter locally under 0BSD.
