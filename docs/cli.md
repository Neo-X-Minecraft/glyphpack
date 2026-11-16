# GlyphPack 1.0.0 CLI

NeoX · 0BSD. Encode/inject need no Node or adjacent sources. Source builds need
a matching checkout and the documented toolchain.

```sh
glyphpack encode input.bin --packing utf8-compact -o payload.gp8
glyphpack encode input.bin --packing pair -o payload.gp16
glyphpack encode input.bin --packing windows -o payload.gp1252
glyphpack inject template.html payload.gp8 standalone.html
glyphpack inject template.html payload.gp1252 standalone.html --encoding windows1252
glyphpack build --full -o full.mjs
glyphpack build --packing pair ans -o recommended-full.mjs
glyphpack build --packing utf8 --format off on --data none -o fast.mjs
glyphpack build --all
```

Templates supply `__PAYLOAD__`, optionally `__CHARSET__`, and an inline module that
reads exact data-element textContent. UTF-8 output is detected from current
indicators; Windows-1252 is explicit. UTF-16LE documents have a BOM.

Defaults: pair, strict format, BLAKE3, memory false. Packing/format/data/memory
axes accept nonempty subsets. Multiple values add runtime handling, one fixes
that policy. Compact-hash changes scalar BLAKE3 code size independently of the
compact codec. Builds are ES modules. Compatibility switches are absent.
No command publishes a release.
