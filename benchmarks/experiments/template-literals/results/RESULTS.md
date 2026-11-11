# Template-literal vocabulary experiment

Local byte counts and real browser-parser checks. Both experiments use bytewise XOR and include a 32-byte BLAKE3 trailer for size parity. UTF-16 variants retain the production header and 31/32-bit pair construction; single-byte variants have a six-digit header and 15/16-bit pairs. These alternative alphabets are not wire-compatible with production format 3.

Mask selection checks all 256 values, skipping only proven nonwinning lower bounds or stopping at the theoretical minimum. It minimizes escaped source size. Original-alphabet packets are checked against the real production Rust encoder.

## Random 10 MiB / utf-16le

Payload source bytes include escapes, headers, the digest and any tag sentinel. They exclude enclosing delimiters, HTML and decoder code. Fixture bytes include framing and the minified raw-tag helper, but exclude the common test decoder.

| Profile | Alphabet | Source bytes | Overhead | Saved vs current | HTML fixture bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| current-rawtext | 63385 | 10528066 | 0.40346% | 0 B | 10528410 |
| current-template | 63385 | 10528356 | 0.40623% | -290 B | 10528520 |
| wide-rawtext | 63485 | 10526198 | 0.38565% | 1868 B | 10526542 |
| wide-template | 63484 | 10526214 | 0.38580% | 1852 B | 10526378 |
| wide-template-reserve-dollar | 63483 | 10526230 | 0.38595% | 1836 B | 10526394 |
| wide-template-escaped | 63486 | 10526480 | 0.38834% | 1586 B | 10526644 |
| all-bmp-escaped | 63488 | 10526710 | 0.39053% | 1356 B | 10526874 |
| all-utf16-escaped | 65536 | 12090334 | 15.30241% | -1562268 B | 12090498 |
| wide-raw-tag | 63485 | 10526200 | 0.38567% | 1866 B | 10526754 |
| wide-template-no-escapes | 63482 | 10526246 | 0.38610% | 1820 B | 10526410 |

## Random 10 MiB / windows-1252

Payload source bytes include escapes, headers, the digest and any tag sentinel. They exclude enclosing delimiters, HTML and decoder code. Fixture bytes include framing and the minified raw-tag helper, but exclude the common test decoder.

| Profile | Alphabet | Source bytes | Overhead | Saved vs current | HTML fixture bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| byte-template | 253 | 10516404 | 0.29224% | 11662 B | 10516512 |
| byte-raw-tag | 254 | 10506221 | 0.19513% | 21845 B | 10506524 |
| byte-rawtext | 254 | 10506072 | 0.19371% | 21994 B | 10506270 |
| byte-template-no-escapes | 251 | 10536546 | 0.48433% | -8480 B | 10536654 |
| byte-template-full | 256 | 10607748 | 1.16337% | -79682 B | 10607856 |
| byte-raw-tag-no-nul | 253 | 10516380 | 0.29202% | 11686 B | 10516683 |


## Parser checks

696 checks passed on 109.0.5414.119 and 156.0.8078.79. This includes 32 deliberately broken controls that must fail. Positive cases preserve exact UTF-16 units or decoded stored bytes, keep the trailing HTML marker and script count, execute no injected expression, use the expected document charset, and make zero network requests under file://.

The suite covers all 65,536 code units; every unit on both sides of sixteen
delimiter/control/surrogate values; all 64 ASCII case variants of the script-end
name and its delimiters; Unicode case lookalikes; existing escape-marker
lookalikes; 65,536-unit slash runs; NUL before digits; CR/LF; BOM; noncharacters;
and paired/lone surrogates. Direct string cases run as modules and strict
classic scripts. Encoded payloads run as modules.

## Escaping

The widest cooked UTF-16 alphabet without per-symbol escaping has 63,484
symbols: exclude NUL, CR, backslash, backtick and surrogates. Contextually escape
interpolation starts and HTML script/comment transitions. One extra slash or
exclamation identity-escape unit breaks the HTML sequence while preserving the
cooked value. Every dangerous pattern is escaped, regardless of probability.

The raw tag admits ordinary backslashes (63,485 symbols). Only reserved slash
runs before interpolation/HTML hazards expand: k original slashes become 2k+1.
Existing escape lookalikes cannot collide. A trailing sentinel protects the
closing quote; the helper removes it and restores the runs. It scans linearly,
including unmatched long runs. Its fixed minified code cost is included in HTML
fixture bytes, separately from payload source bytes.

The 63,482-symbol template control excludes dollar and less-than as well,
avoiding all contextual escapes. A widened raw-script alphabet has 63,485
symbols, showing that the extra characters are not unique to template literals.
The all-65,536 variant must additionally escape lone surrogates and syntax or
altered units; this can overwhelm its larger nominal radix.

## Single-byte extension

Windows-1252 has 256 distinct decoded values in both tested browsers. In HTML
script data, source NUL becomes U+FFFD. The experiment deliberately assigns that
unique replacement character as the digit for source byte zero. It is not
pretending that an actual NUL string character survived. A control without the
NUL digit is measured separately.

This yields 254 raw-tag digits after excluding CR and backtick, or 253 cooked
digits after also excluding backslash. Only dangerous combinations need the
same contextual escaping. The raw-script control excludes CR and less-than and
also has 254 digits. The fixed header contains two radix digits for settings
and four for stored length; the body uses 15/16-bit symbol pairs.

These pages have an early explicit Windows-1252 meta declaration and no BOM.
They must retain that encoding: forcing UTF-8, transcoding the file or treating
it as an external UTF-8 ES module changes the transport. Parser checks assert
the actual document charset, byte equality and the entire alphabet in both
browsers. This is a separate HTML-specific format, not an interchangeable
UTF-16 payload.

## Measurement limits

These are size/parser experiments, not production decoder-speed benchmarks.
The independent JS decoder checks structure and returns stored bytes; it does
not implement BLAKE3 verification. SHA-256 compares the entire decoded buffer,
including the trailer, with Rust's expected file. The common decoder is injected
by the harness, so fixture sizes are not complete shipping decoder-bundle sizes.
UTF-8 lengths serialize the logical source string for context, not the physical
single-byte file or a raw-file transcode. The intentional U+FFFD digit takes
three UTF-8 bytes in that comparison but one source NUL byte in the actual HTML.
These lengths are not used as document byte counts.

A uniform 63,484-symbol one-unit alphabet has an ideal asymptotic expansion
around 0.28767%; the 254-symbol single-byte alphabet around 0.14164%, before
framing and escapes. Reaching these bounds needs denser packing than this pair
codec. The experiment checks the stated alphabets and all masks, not arbitrary
coding schemes, reorderings or stateful alphabets.

## Reproduce

Run from the repository root:

    cargo run --release --locked --example encoder_compare -- --prepare
    cargo run --release --locked --example template_literals
    node benchmarks/experiments/template-literals/check.cjs
    cargo run --release --locked --example template_literals -- --report

Raw fixtures and manifest: generated/template-literals/. CSVs and browser
evidence are next to this report. Sources: examples/template_literals.rs and
benchmarks/experiments/template-literals/. The checker requires actual Chrome
109 and the pinned Chromium 156.

Standards: [script contents](https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements),
[HTML preprocessing](https://html.spec.whatwg.org/multipage/parsing.html#preprocessing-the-input-stream),
[template literals](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-template-literal-lexical-components),
[UTF-16 decoding](https://encoding.spec.whatwg.org/#shared-utf-16-decoder),
[Windows-1252 index](https://encoding.spec.whatwg.org/index-windows-1252.txt).
