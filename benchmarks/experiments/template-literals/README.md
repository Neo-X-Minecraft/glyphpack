# Template-literal vocabulary tests

Local experiments for denser standalone HTML payloads, under 0BSD by NeoX.

[Results](results/RESULTS.md) · [Compact CSV](results/compact.csv) ·
[All sizes](results/all-sizes.csv) · [Browser evidence](results/browser-checks.json)

- `codec.rs`: alternate alphabets, pair packing, source-aware exhaustive XOR
  selection, cooked-template escaping and reversible raw-tag markers.
- `raw-tag.js`: small tagged-template restoration helper.
- `decoder.js`: independent browser reference decoder.
- `check.cjs`: actual offline HTML parsing on Chrome 109 and Chromium 156.
- `report.rs` and `notes.md`: reproducible reports and interpretation.
- `../../../examples/template_literals.rs`: native Rust fixture generator.

Commands and encoding constraints are in the report. Generated HTML and data
remain under ignored `generated/template-literals/`. The experiments include
new alphabets and headers; they are separate from the production wire format.

Follow-up [packing and complete browser-startup measurements](../packing/results/RESULTS.md)
compare the alphabets with grouped words, interleaved ANS, native Base64 and
matched verification in real Chrome 109 and Chromium 156.
