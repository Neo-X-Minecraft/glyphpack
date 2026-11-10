# GlyphPack native CLI

By NeoX, 0BSD. This archive contains a statically linked Linux executable,
its source commit, and third-party notices. Choose the x86_64 or aarch64 archive
for your CPU. Extract it and run `./glyphpack --version`.

Encoding and HTML insertion require no installation, Node.js, or neighboring
source files:

```sh
# UTF-16LE payload, automatic mask selection, BLAKE3 by default.
./glyphpack encode input.bin -o payload.gp16

# Faster sampled mask search; never larger than the identity-mask body.
./glyphpack encode input.bin --effort fast -o payload.gp16

# Explicit verification mode or a fixed mask, useful for benchmarks.
./glyphpack encode input.bin --checksum fast --mask 0 -o payload.gp16

# UTF-8 representation for callers managing their own text container.
./glyphpack encode input.bin --text -o payload.txt

# Replace __PAYLOAD__ in a UTF-8 template; write a UTF-16LE HTML document.
./glyphpack inject template.html payload.gp16 standalone.html
```

The template supplies the browser module and calls `binary()` on the inserted
payload element's `textContent`. Do not trim or escape that text. A digest checks
bytes; an unkeyed digest does not establish authorship. See the repository's
format documentation and browser examples.

Commands that compile decoders, build the demo, or run repository tests and
benchmarks need the matching source checkout. Run them from that checkout or
set `GLYPHPACK_ROOT=/path/to/glyphpack`. They also require the build tools listed
in the repository README. `encode` and `inject` are independent of those tools.

Source and live workbench: https://github.com/Neo-X-Minecraft/glyphpack
