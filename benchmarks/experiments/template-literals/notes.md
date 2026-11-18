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
