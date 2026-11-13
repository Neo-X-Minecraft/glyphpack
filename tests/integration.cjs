/* 0BSD, NeoX. Five tagged codecs, all subsets, all selected verification axes,
 * hash ABI, old raw compatibility, and exact native source representations. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, ".."),
  v = require("../generated/integration/vectors.json"),
  hex = (b) => Buffer.from(b).toString("hex");
const url = (s) =>
  "data:text/javascript;base64," + Buffer.from(s).toString("base64");
(async () => {
  let comparisons = 0,
    rejections = 0;
  for (const b of v.builds) {
    const code = fs.readFileSync(b.file, "utf8"),
      m = await import(url(code) + "#" + b.name);
    m.warmup();
    m.warmup(
      b.packings,
      b.packings.map(() => false),
    );
    assert.equal(m.warmup.length, 2);
    assert.throws(() => m.warmup(["missing"]), /Unsupported payload codec/);
    for (const r of v.rows)
      for (const [packing, text] of Object.entries(r.packets)) {
        if (!b.packings.includes(packing)) {
          if (r.mask === 0 && r.hex.length === 2) {
            assert.throws(
              () => m.binary(text, { verifyData: b.data.at(-1) }),
              /Unsupported payload codec/,
            );
            rejections++;
          }
          continue;
        }
        if (!b.data.includes(r.mode)) continue;
        for (const verifyFormat of b.format)
          for (const memoryHeavy of b.memory ? [false, true] : [false]) {
            const got = m.binary(text, {
              verifyData: r.mode,
              verifyFormat,
              memoryHeavy,
            });
            assert.equal(
              hex(got),
              r.hex,
              b.name + " " + packing + " " + r.mode,
            );
            comparisons++;
          }
      }
    for (const r of v.corrupt)
      if (b.packings.includes(r.packing) && b.data.includes(r.mode))
        for (const verifyFormat of b.format) {
          assert.throws(
            () => m.binary(r.text, { verifyData: r.mode, verifyFormat }),
            r.mode === "fast"
              ? /Payload checksum mismatch/
              : /Payload digest mismatch/,
          );
          rejections++;
        }
    if (b.name.endsWith("core")) {
      assert(
        !code.includes("WebAssembly"),
        "Raw-only build contains Wasm loading",
      );
      assert(!code.includes("Payload digest mismatch"));
      assert(!code.includes("Invalid payload character"));
    }
  }
  const full = await import(
      pathToFileURL(path.join(root, "dist/full.min.mjs"))
    ),
    sample = v.rows.find(
      (r) => r.mode === "secure" && r.hex.length === 514 && r.mask === 0,
    ),
    none = v.rows.find(
      (r) => r.mode === "none" && r.hex.length === 514 && r.mask === 0,
    );
  for (const name of ["utf8", "utf8-compact"]) {
    assert.throws(
      () => full.binary(none.packets[name]),
      /Required payload integrity mode missing/,
    );
    assert.equal(
      hex(full.binary(sample.packets[name], { verifyData: false })),
      sample.hex,
    );
    assert.equal(
      hex(full.binary(sample.packets[name], { verifyData: true })),
      sample.hex,
    );
    assert.throws(
      () => full.binary(sample.packets[name], { verifyData: "crc32" }),
      /Unsupported data verification mode/,
    );
    assert.throws(
      () => full.binary(sample.packets[name], { verifyFormat: "true" }),
      /Unsupported format verification option/,
    );
    for (const verifyData of ["none", "secure"])
      for (const text of [
        sample.packets[name].slice(0, -2),
        String.fromCharCode(name === "utf8" ? 11 : 14) +
          "2" +
          (name === "utf8" ? "~u2" : "~c1") +
          "AAA",
        String.fromCharCode(name === "utf8" ? 11 : 14) +
          "0" +
          (name === "utf8" ? "~u2" : "~c1") +
          "AAggggB",
      ]) {
        assert.throws(() =>
          full.binary(text, { verifyFormat: false, verifyData }),
        );
        rejections++;
      }
    const helper =
      name === "utf8" ? full.decodeRawUtf8 : full.decodeRawUtf8Compact;
    assert.equal(hex(helper(none.packets[name].slice(2))), none.hex);
    const held = full.binary(sample.packets[name]);
    full.binary(sample.packets.pair);
    assert.equal(hex(held), sample.hex);
  }
  for (const b of v.builds.filter((b) => b.name.endsWith("core"))) {
    const wasm = global.WebAssembly,
      ds = global.DecompressionStream;
    try {
      global.WebAssembly = undefined;
      global.DecompressionStream = undefined;
      const m = await import(url(fs.readFileSync(b.file, "utf8")) + "#no-wasm");
      for (const name of b.packings)
        assert.equal(hex(m.binary(none.packets[name])), none.hex);
    } finally {
      global.WebAssembly = wasm;
      global.DecompressionStream = ds;
    }
  }
  // Observe actual native calls without adding diagnostic overhead to the build.
  const instantiate = WebAssembly.instantiate,
    calls = { decode: 0, verify: 0, warm: [] };
  let api;
  WebAssembly.instantiate = async (...args) => {
    const r = await instantiate(...args);
    api = r.instance.exports;
    return {
      ...r,
      instance: {
        exports: {
          ...api,
          decode(...a) {
            calls.decode++;
            return api.decode(...a);
          },
          verify_bytes(...a) {
            calls.verify++;
            return api.verify_bytes(...a);
          },
          warmup(...a) {
            calls.warm.push(a);
            return api.warmup(...a);
          },
        },
      },
    };
  };
  try {
    const observed = await import(
      url(fs.readFileSync(path.join(root, "dist/full.min.mjs"), "utf8")) +
        "#observe"
    );
    observed.warmup();
    assert.deepEqual(calls.warm[0], [1, 0]);
    observed.warmup(["utf8", "utf8-compact"], [true, true]);
    assert.deepEqual(calls.warm.at(-1), [0, 0]);
    for (const name of ["utf8", "utf8-compact"]) {
      observed.binary(none.packets[name], { verifyData: "none" });
      assert.equal(calls.decode, 0);
      assert.equal(calls.verify, 0);
    }
    observed.binary(sample.packets.utf8);
    assert.equal(calls.verify, 1);
    assert.equal(calls.decode, 0);
    observed.binary(sample.packets["utf8-compact"]);
    assert.equal(calls.verify, 2);
    assert.equal(calls.decode, 0);
    observed.binary(sample.packets.pair);
    assert.equal(calls.decode, 1);
    api.input_ptr(0);
    assert.equal(api.verify_bytes(32, 2), 2);
    assert.equal(api.verify_bytes(0, 2), 2);
    assert.equal(api.verify_bytes(0, 3), 5);
  } finally {
    WebAssembly.instantiate = instantiate;
  }
  const result = {
    passed: true,
    node: process.version,
    subsets: 31,
    builds: v.builds.length,
    comparisons,
    rejections,
    nativeDispatch: calls,
  };
  fs.mkdirSync(path.join(root, "generated/integration/results"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "generated/integration/results/node.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
