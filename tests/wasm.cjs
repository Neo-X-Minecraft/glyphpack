/* 0BSD, NeoX. Direct current ABI, digest bounds, output ownership and SIMD KATs. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  v = JSON.parse(
    fs.readFileSync(path.join(root, "generated/test-vectors.json")),
  );
(async () => {
  const p = v.profiles.find(
      (p) =>
        p.formats.length === 2 &&
        p.modes.length === 3 &&
        p.memories.length === 2,
    ),
    api = new WebAssembly.Instance(
      new WebAssembly.Module(fs.readFileSync(p.wasm)),
    ).exports;
  function run(text, mode = 0, format = 1, heavy = 0) {
    const ptr = api.input_ptr(text.length),
      input = new DataView(api.memory.buffer);
    for (let i = 0; i < text.length; i++)
      input.setUint16(ptr + i * 2, text.charCodeAt(i), true);
    const status = api.decode(format, mode, heavy);
    if (status) return { status };
    return {
      status,
      bytes: new Uint8Array(
        api.memory.buffer,
        api.output_ptr(),
        api.payload_len(),
      ).slice(),
    };
  }
  let comparisons = 0;
  for (const r of v.rows)
    for (const [mode, name] of ["none", "fast", "secure"].entries())
      for (const fmt of [0, 1])
        for (const heavy of [0, 1]) {
          const got = run(r.packets[name], mode, fmt, heavy);
          assert.equal(got.status, 0);
          assert.equal(Buffer.from(got.bytes).toString("hex"), r.rawHex);
          comparisons++;
        }
  const official = JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/blake3-vectors.json")),
  );
  for (const r of official.cases) {
    const data = Buffer.from(
        Uint8Array.from({ length: r.input_len }, (_, i) => i % 251),
      ),
      text = execFileSync(
        process.env.GLYPHPACK_BIN ||
          path.join(root, "target/release/glyphpack"),
        ["encode", "-", "--mask", "0", "--text"],
        { input: data, encoding: "utf8" },
      );
    const got = run(text, 2);
    assert.equal(got.status, 0);
    assert.deepEqual(Buffer.from(got.bytes), data);
  }
  const malformed =
    "\t" +
    String.fromCharCode(
      v.alphabet[32768],
      v.alphabet[1048576 % 63385],
      v.alphabet[Math.floor(1048576 / 63385)],
    );
  const memory = api.memory.buffer.byteLength;
  assert.notEqual(run(malformed, 0, 0, 1).status, 0);
  assert.equal(api.memory.buffer.byteLength, memory);
  console.log(
    JSON.stringify({
      pass: true,
      comparisons,
      officialKernelCases: official.cases.length,
      allocationSafety: true,
      currentFormatOnly: true,
    }),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
