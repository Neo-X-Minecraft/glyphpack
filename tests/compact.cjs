/* 0BSD, NeoX. Independent JS channel oracle, integrity corruption and ABI bounds. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process"),
  { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, ".."),
  v = require("../generated/integration/vectors.json"),
  digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  hex = (b) => Buffer.from(b).toString("hex"),
  source = fs.readFileSync(path.join(root, "dist/full.min.mjs"), "utf8");
function parts(text) {
  const raw = text.replace(/<\x01\x01\x01/g, "<");
  let at = 7,
    length = 0,
    power = 1,
    d;
  do {
    d = digits.indexOf(raw[at++]);
    length += (d & 31) * power;
    power *= 32;
  } while (d & 32);
  let state = 0;
  for (let i = 0; i < 7; i++) state += digits.indexOf(raw[at++]) * 2 ** (6 * i);
  return {
    body: raw.slice(at),
    start: at,
    length,
    state,
    mask: digits.indexOf(raw[5]) | (digits.indexOf(raw[6]) << 6),
  };
}
(async () => {
  let api;
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async (...a) => {
    const r = await instantiate(...a);
    // The Module overload returns an Instance directly. Node may also create
    // its own HTTP-parser Wasm during import, so capture only this codec's ABI.
    const exports = (r.instance || r).exports;
    if (typeof exports.decode_compact === "function") api = exports;
    return r;
  };
  let m;
  try {
    m = await import(
      "data:text/javascript;base64," + Buffer.from(source).toString("base64")
    );
  } finally {
    WebAssembly.instantiate = instantiate;
  }
  assert(api, "GlyphPack compact Wasm ABI was not instantiated");
  const oracle = await import(
    pathToFileURL(path.join(root, "tests/reference/compact.mjs"))
  );
  assert.deepEqual(
    m.binary("\x0e0~c2AAA" + "AAAAABA", { verifyData: "none" }),
    new Uint8Array(0),
  );
  // A zero-output terminal symbol is a noncanonical alternative only in unchecked text.
  const aliasState = 58821 * 128,
    stateText = Array.from(
      { length: 7 },
      (_, i) => digits[Math.floor(aliasState / 2 ** (6 * i)) & 63],
    ).join("");
  const alias = "\x0e0~c2AAA" + stateText + "\x01";
  assert.throws(
    () => m.binary(alias, { verifyData: "none" }),
    /Invalid payload padding/,
  );
  assert.deepEqual(
    m.binary(alias, { verifyFormat: false, verifyData: "none" }),
    new Uint8Array(0),
  );
  let comparisons = 0,
    rejections = 1;
  for (const r of v.rows) {
    const text = r.packets["utf8-compact"];
    if (text.slice(2, 5) !== "~c2") continue;
    const p = parts(text),
      stored = oracle.ans(p.body, p.state, p.length, 30);
    for (let i = 0; i < stored.length; i++) stored[i] ^= p.mask;
    assert.equal(hex(stored.subarray(0, r.hex.length / 2)), r.hex);
    comparisons++;
  }
  for (const mode of ["fast", "secure"]) {
    const r = v.rows.find(
        (r) =>
          r.mode === mode &&
          r.mask === 0 &&
          r.packets["utf8-compact"].slice(2, 5) === "~c2",
      ),
      p = parts(r.packets["utf8-compact"]),
      stored = oracle.ans(p.body, p.state, p.length, 30);
    stored[0] ^= 1;
    const corrupt = execFileSync(
      path.join(root, "target/release/glyphpack"),
      [
        "encode",
        "-",
        "--packing",
        "utf8-compact",
        "--checksum",
        "none",
        "--mask",
        "0",
      ],
      { input: stored, encoding: "utf8" },
    );
    const text = corrupt[0] + (mode === "fast" ? "1" : "2") + corrupt.slice(2);
    for (const verifyFormat of [false, true]) {
      assert.throws(
        () => m.binary(text, { verifyData: mode, verifyFormat }),
        mode === "fast"
          ? /Payload checksum mismatch/
          : /Payload digest mismatch/,
      );
      rejections++;
    }
  }
  const r = v.rows.find(
      (r) =>
        r.mode === "secure" &&
        r.mask === 0 &&
        r.packets["utf8-compact"].slice(2, 5) === "~c2",
    ),
    text = r.packets["utf8-compact"],
    p = parts(text);
  for (const verifyFormat of [false, true])
    for (const bad of [
      text.slice(0, p.start - 1),
      text.slice(0, -1),
      text.slice(0, p.start - 1) + "_" + text.slice(p.start),
      text.slice(0, -1) + "\0",
      text.slice(0, -1) + "\r",
      text.slice(0, -1) + "\ud800",
      text.slice(0, -1) + "\ufdd0",
    ]) {
      assert.throws(() => m.binary(bad, { verifyFormat }));
      rejections++;
    }
  const held = m.binary(text);
  m.binary(r.packets.pair);
  assert.equal(hex(held), r.hex);
  assert.deepEqual(
    m.binary("\x0e0~c2AAA" + "AAAAABA", { verifyData: "none" }),
    new Uint8Array(0),
  );
  api.input_ptr(0);
  const memory = api.memory.buffer.byteLength;
  for (const a of [
    [1048576, 0, 0, 0, 0, 0],
    [32, 0, 0, 0, 2, 2],
    [0, 0, 64, 0, 0, 0],
    [0, 0, 0, 256, 0, 0],
  ]) {
    assert.notEqual(api.decode_compact(...a), 0);
    assert.equal(api.memory.buffer.byteLength, memory);
    rejections++;
  }
  assert.equal(api.decode_compact(0, 1 << 30, 0, 0, 0, 0), 0);
  console.log(
    JSON.stringify({
      passed: true,
      oracleComparisons: comparisons,
      rejections,
      empty: true,
      ownership: true,
      allocationSafety: true,
    }),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
