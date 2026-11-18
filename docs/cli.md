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

`encode` reads a file or `-` for stdin, and writes stdout unless `-o` is supplied.
`--checksum secure|fast|none` selects the stored trailer. `--mask 0..255` (also hex,
such as `0xff`) forces a mask; otherwise the encoder chooses one. `--effort full`
is the default size search; `--effort fast` reduces encoding work. The decoder
does not need to know the encoder's effort setting.

Without `--text`, output uses the codec's native source charset: UTF-16LE for
pair/ANS, Windows-1252 for Windows, UTF-8 for the UTF-8 codecs. `--text` instead
writes the logical JavaScript string as UTF-8, useful for source literals and
interchange. It does not retain the UTF-16/Windows source-size benefit.

The injector replaces `__PAYLOAD__` with the appropriate inert data element and
`__CHARSET__` with its encoding name. The template owns the decoder code and reads
`document.getElementById('payload').textContent`. It is not an arbitrary minifier
or module bundler. The workbench can create a complete standalone page directly.

Custom builds and runtime settings are documented in [configuration.md](configuration.md).
Single builds write declarations only when `--types path` is supplied; `--all`
writes them for every standard profile. `--readable` produces inspectable source.
