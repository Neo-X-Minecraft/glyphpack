/* 0BSD, NeoX. All seven codec selections, independent validation policies,
 * direct-ABI rejection, arena safety, physical encodings and offline browsers. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  crypto = require("node:crypto"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  v = JSON.parse(
    fs.readFileSync(
      process.argv[2] || path.join(root, "generated/codecs/vectors.json"),
    ),
  );
const names = ["pair", "ans", "windows"],
  tags = { pair: 9, ans: 10, windows: 12 };
const recommendedSources = ["recommended", "recommended-full"].map((n) =>
  fs.readFileSync(path.join(root, "dist/" + n + ".min.mjs"), "utf8"),
);
// Observe the real ABI calls to prove the public no-argument policy, without
// exposing diagnostic state or adding tracking overhead to shipped modules.
async function observedModule(source) {
  const calls = [],
    instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async (...args) => {
    const result = await instantiate(...args),
      api = result.instance.exports;
    return {
      ...result,
      instance: {
        exports: {
          ...api,
          warmup(...flags) {
            calls.push(flags);
            return api.warmup(...flags);
          },
        },
      },
    };
  };
  try {
    return {
      ...(await import(
        "data:text/javascript;base64," + Buffer.from(source).toString("base64")
      )),
      calls,
    };
  } finally {
    WebAssembly.instantiate = instantiate;
  }
}
// Exercise the real CLI serializer and inert-script parser under file://.
// JSON stays ASCII so the Windows document never silently transcodes its shell.
function physicalFiles() {
  const { execFileSync } = require("node:child_process");
  const folder = path.join(root, "generated/codecs/files");
  fs.mkdirSync(folder, { recursive: true });
  const row = v.rows.find(
      (r) => r.kind === "secure" && r.mask === 85 && r.rawHex.length === 8194,
    ),
    full = v.builds.find((b) => b.packings.length === 3 && !b.core);
  const literal = (value) =>
    JSON.stringify(value).replace(
      /[\u007f-\uffff<]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  const script = (items) =>
    `<script type="module">try{const url=URL.createObjectURL(new Blob([${literal(full.source)}],{type:'text/javascript'}));const {binary}=await import(url);URL.revokeObjectURL(url);for(const [id,expected] of ${literal(items)}){const text=document.getElementById(id).textContent;if(text!==expected)throw Error('HTML changed payload '+id);const out=binary(text);if(Array.from(out,b=>b.toString(16).padStart(2,'0')).join('')!==${literal(row.rawHex)})throw Error('Wrong file bytes');}globalThis.result={pass:true,cases:${items.length}}}catch(e){globalThis.result={pass:false,error:e.message}}</script>`;
  const input = path.join(folder, "input.bin");
  fs.writeFileSync(input, Buffer.from(row.rawHex, "hex"));
  const files = [];
  for (const name of names) {
    const packet = path.join(folder, name + ".gp"),
      template = path.join(folder, name + ".template.html"),
      out = path.join(folder, name + ".html");
    execFileSync(path.join(root, "target/release/glyphpack"), [
      "encode",
      input,
      "--packing",
      name,
      "--mask",
      "85",
      "-o",
      packet,
    ]);
    fs.writeFileSync(
      template,
      '<!doctype html><meta charset="__CHARSET__">__PAYLOAD__' +
        script([["payload", row.packets[name]]]),
    );
    execFileSync(path.join(root, "target/release/glyphpack"), [
      "inject",
      template,
      packet,
      out,
      "--encoding",
      name === "windows" ? "windows1252" : "utf16le",
    ]);
    files.push(out);
  }
  const mixed = path.join(folder, "mixed.html");
  fs.writeFileSync(
    mixed,
    Buffer.from(
      '\ufeff<!doctype html><meta charset="utf-16le">' +
        names
          .map(
            (n) =>
              '<script type="application/octet-stream" id="' +
              n +
              '">' +
              row.packets[n] +
              "</script>",
          )
          .join("") +
        script(names.map((n) => [n, row.packets[n]])),
      "utf16le",
    ),
  );
  files.push(mixed);
  return files;
}
(async () => {
  let abi = 0;
  let warmupAbi = 0;
  let automaticAbi = 0;
  for (const b of v.builds) {
    const compiled = await WebAssembly.compile(fs.readFileSync(b.wasm));
    const api = new WebAssembly.Instance(compiled).exports;
    // Each selected codec also starts from its own completely cold instance.
    // Decoding with every needed strategy must leave no cache work for warmup.
    for (const name of b.packings) {
      const cold = new WebAssembly.Instance(compiled).exports;
      const row = v.rows.find(
          (r) => r.kind === "none" && r.rawHex.length === 514,
        ),
        text = row.packets[name];
      const pointer = cold.input_ptr(text.length),
        input = new Uint16Array(cold.memory.buffer, pointer, text.length);
      for (let i = 0; i < text.length; i++) input[i] = text.charCodeAt(i);
      assert.equal(cold.decode(0, 0, 1), 0);
      assert.equal(
        Buffer.from(
          new Uint8Array(
            cold.memory.buffer,
            cold.output_ptr(),
            cold.payload_len(),
          ),
        ).toString("hex"),
        row.rawHex,
      );
      const ready = Buffer.from(new Uint8Array(cold.memory.buffer));
      assert.equal(cold.warmup(1 << names.indexOf(name)), 0);
      assert(
        ready.equals(Buffer.from(new Uint8Array(cold.memory.buffer))),
        "Decode left codec caches cold",
      );
      automaticAbi++;
    }
    if (b.packings.length === 3 && !b.core) {
      const selected = new WebAssembly.Instance(compiled).exports,
        initial = selected.memory.buffer.byteLength;
      assert.equal(selected.warmup(4), 0);
      assert.equal(selected.warmup(2), 0);
      assert.equal(
        selected.memory.buffer.byteLength,
        initial,
        "Non-pair warming allocated the heavy lookup",
      );
      assert.equal(selected.warmup(1, 0), 0);
      assert.equal(
        selected.memory.buffer.byteLength,
        initial,
        "Default warming enabled heavy optimization",
      );
      assert.equal(selected.warmup(1, 1), 0);
      assert(
        selected.memory.buffer.byteLength > initial,
        "Pair warming missed the heavy lookup",
      );
      assert.equal(selected.stored_len(), 0);
      assert.equal(selected.payload_len(), 0);
    }
    const mask = b.packings.reduce((m, n) => m | (1 << names.indexOf(n)), 0);
    const snapshot = () => Buffer.from(new Uint8Array(api.memory.buffer));
    const before = snapshot();
    assert.equal(api.warmup(0), 0);
    assert.equal(api.warmup(mask | 8), 9);
    assert.equal(api.warmup(mask, 2), 10);
    if (b.core || !b.packings.includes("pair"))
      assert.equal(api.warmup(mask, 1), 10);
    assert(before.equals(snapshot()), "Empty/invalid warm-up changed memory");
    // Preserve pending input and completed output even when warming the heavy
    // lookup grows linear memory. Snapshot by value, never alias Wasm memory.
    const name = b.packings[0],
      row = v.rows.find((r) => r.kind === "none" && r.rawHex.length === 514),
      text = row.packets[name];
    const pointer = api.input_ptr(text.length);
    const pending = new Uint16Array(api.memory.buffer, pointer, text.length);
    for (let i = 0; i < text.length; i++) pending[i] = text.charCodeAt(i);
    assert.equal(api.decode(0, 0, 0), 0);
    const output = api.output_ptr(),
      stored = api.stored_len(),
      length = api.payload_len();
    const inputCopy = Buffer.from(
      new Uint8Array(api.memory.buffer, pointer, text.length * 2),
    );
    const outputCopy = Buffer.from(
      new Uint8Array(api.memory.buffer, output, stored),
    );
    const heavy = !b.core && mask & 1 ? 1 : 0;
    assert.equal(api.warmup(mask, heavy), 0);
    assert(
      inputCopy.equals(
        Buffer.from(
          new Uint8Array(api.memory.buffer, pointer, text.length * 2),
        ),
      ),
    );
    assert(
      outputCopy.equals(
        Buffer.from(new Uint8Array(api.memory.buffer, output, stored)),
      ),
    );
    assert.deepEqual(
      [api.output_ptr(), api.stored_len(), api.payload_len()],
      [output, stored, length],
    );
    const ready = snapshot();
    for (let bit = 1; bit <= 4; bit <<= 1)
      if (mask & bit) assert.equal(api.warmup(bit), 0);
    assert.equal(api.warmup(mask), 0);
    assert(
      ready.equals(snapshot()),
      "Repeated warm-up changed state or allocated again",
    );
    assert.equal(api.decode(0, 0, 0), 0);
    assert(
      outputCopy.equals(
        Buffer.from(new Uint8Array(api.memory.buffer, output, stored)),
      ),
    );
    warmupAbi++;
    for (const name of names) {
      if (b.packings.includes(name)) continue;
      const text = v.rows.find(
        (r) => r.kind === "none" && r.rawHex.length === 514,
      ).packets[name];
      const ptr = api.input_ptr(text.length);
      const input = new Uint16Array(api.memory.buffer, ptr, text.length);
      for (let i = 0; i < text.length; i++) input[i] = text.charCodeAt(i);
      assert.equal(api.decode(0, 0, 0), 9);
      abi++;
    }
    if (b.packings.length === 3 && !b.core) {
      for (const item of v.large) {
        const raw = fs.readFileSync(item.file),
          ptr = api.input_ptr(raw.length / 2);
        new Uint8Array(api.memory.buffer, ptr, raw.length).set(raw);
        assert.equal(api.decode(1, 2, 1), 0);
        const end = api.output_ptr(),
          size = api.stored_len();
        assert(
          end + size <= ptr || ptr + raw.length <= end,
          "Input/output arenas overlap",
        );
        abi++;
      }
    }
  }
  const server = http.createServer((req, res) => {
    const match = /^\/large\/(\d+)$/.exec(req.url);
    if (!match) {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html>");
      return;
    }
    const item = v.large[+match[1]];
    if (!item) {
      res.writeHead(404).end();
      return;
    }
    fs.createReadStream(item.file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const results = [];
  if (process.env.GLYPHPACK_CODECS_NODE === "1") {
    let positive = 0,
      unsupported = 0,
      rejected = 0;
    for (const b of v.builds) {
      const { binary, warmup, calls } = await observedModule(b.source);
      const sample = v.rows.find(
        (r) =>
          r.kind === (b.core ? "none" : "secure") && r.rawHex.length === 514,
      );
      const saved = binary(sample.packets[b.packings[0]]); // automatic cold initialization
      if (!b.core)
        for (const answer of v.official)
          for (const name of ["ans", "windows"].filter((n) =>
            b.packings.includes(n),
          )) {
            const out = binary(answer.packets[name]);
            assert.equal(out.length, answer.size);
            for (let i = 0; i < out.length; i++) assert.equal(out[i], i % 251);
          }
      assert.equal(warmup.length, 2);
      for (const name of b.packings) {
        let reads = 0;
        const codecs = [];
        Object.defineProperty(codecs, 0, {
          get() {
            reads++;
            return name;
          },
          configurable: true,
        });
        warmup(codecs, [false]);
        assert.equal(reads, 1, "Warm-up reread a codec accessor");
      }
      assert.equal(warmup(), undefined);
      assert.deepEqual(calls.at(-1), [1 << names.indexOf(b.packings[0]), 0]);
      assert.throws(
        () => warmup("pair"),
        /Expected an array of payload codecs/,
      );
      assert.throws(
        () => warmup([...b.packings, "unknown"]),
        /Unsupported payload codec/,
      );
      for (const name of names.filter((n) => !b.packings.includes(n)))
        assert.throws(() => warmup([name]), /Unsupported payload codec/);
      warmup([]);
      for (const name of b.packings) warmup([name]);
      warmup([...b.packings, ...b.packings]);
      warmup(
        b.packings,
        b.packings.map(() => false),
      );
      for (const name of b.packings) {
        warmup([name], [name === "pair" ? !b.core : true]);
        assert.deepEqual(calls.at(-1), [
          1 << names.indexOf(name),
          name === "pair" && !b.core ? 1 : 0,
        ]);
      }
      const beforeInvalid = calls.length;
      for (const [codecs, flags, error] of [
        [b.packings, [], /same length/],
        [[], [false], /same length/],
        [b.packings, false, /array of memory flags/],
        [b.packings, b.packings.map(() => 0), /boolean memory flags/],
      ]) {
        assert.throws(() => warmup(codecs, flags), error);
      }
      assert.equal(calls.length, beforeInvalid, "Invalid lists reached Wasm");
      if (b.core && b.packings.includes("pair"))
        assert.throws(
          () => warmup(["pair"], [true]),
          /Unsupported memory optimization option/,
        );
      assert.equal(Buffer.from(saved).toString("hex"), sample.rawHex);
      for (const row of v.rows) {
        if (b.core && row.kind !== "none") continue;
        for (const name of names) {
          const options = {
            verifyFormat: !b.core,
            verifyData: row.kind,
            memoryHeavy: false,
          };
          if (!b.packings.includes(name)) {
            if (row.mask === 0 && row.rawHex.length === 514) {
              assert.throws(
                () =>
                  binary(row.packets[name], {
                    verifyFormat: false,
                    verifyData: "none",
                  }),
                /Unsupported payload codec/,
              );
              unsupported++;
            }
            continue;
          }
          if (row.reject) {
            assert.throws(
              () => binary(row.packets[name], options),
              new RegExp(
                row.kind === "fast"
                  ? "Payload checksum mismatch"
                  : "Payload digest mismatch",
              ),
            );
            rejected++;
            continue;
          }
          const out = binary(row.packets[name], options);
          assert.equal(Buffer.from(out).toString("hex"), row.rawHex);
          positive++;
        }
      }
    }
    const fixedHeavy = await observedModule(
      fs.readFileSync(path.join(root, "dist/high-memory.min.mjs"), "utf8"),
    );
    fixedHeavy.warmup();
    assert.deepEqual(
      fixedHeavy.calls.at(-1),
      [1, 0],
      "Fixed-heavy build changed the no-argument policy",
    );
    const report = {
      pass: true,
      node: process.version,
      directAbiCases: abi,
      warmupAbi,
      automaticAbi,
      positive,
      unsupported,
      rejected,
    };
    fs.writeFileSync(
      path.join(root, "generated/codecs/node-results.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    await new Promise((r) => server.close(r));
    return;
  }
  const files = physicalFiles();
  try {
    for (const bin of [
      process.env.CHROMIUM_BIN || "/usr/bin/chromium",
      process.env.CHROMIUM109_BIN ||
        path.join(root, ".tools/chromium109/chromium"),
    ].filter((bin, i) => i === 0 || fs.existsSync(bin))) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: bin,
        args: ["--no-sandbox"],
      });
      try {
        const page = await browser.newPage();
        await page.goto(origin);
        await page.evaluate(
          async (urls) =>
            (globalThis.modules = await Promise.all(
              urls.map((u) => import(u)),
            )),
          v.builds
            .map(
              (b) =>
                "data:text/javascript;base64," +
                Buffer.from(b.source).toString("base64"),
            )
            .concat(
              recommendedSources.map(
                (s) =>
                  "data:text/javascript;base64," +
                  Buffer.from(s).toString("base64"),
              ),
            ),
        );
        const recommended = await page.evaluate(
          ({ start, rows }) => {
            let cases = 0;
            for (let i = 0; i < 2; i++) {
              const m = modules[start + i],
                names = i ? ["pair", "ans"] : ["pair"],
                row = rows.find(
                  (r) => r.kind === "secure" && r.rawHex.length === 514,
                ),
                none = rows.find(
                  (r) => r.kind === "none" && r.rawHex.length === 514,
                ),
                stale = rows.find((r) => r.reject && r.kind === "secure");
              const mustFail = (fn, error) => {
                let message;
                try {
                  fn();
                } catch (e) {
                  message = e.message;
                }
                if (message !== error)
                  throw Error("Recommended policy: " + message);
                cases++;
              };
              m.warmup();
              m.warmup(
                names,
                names.map(() => false),
              );
              for (const name of names) {
                const out = m.binary(row.packets[name]);
                if (
                  Array.from(out, (b) => b.toString(16).padStart(2, "0")).join(
                    "",
                  ) !== row.rawHex
                )
                  throw Error("Recommended bytes");
                cases++;
                mustFail(
                  () =>
                    m.binary(none.packets[name], {
                      verifyData: "none",
                      verifyFormat: false,
                    }),
                  "Required payload integrity mode missing",
                );
                mustFail(
                  () =>
                    m.binary(stale.packets[name], {
                      verifyData: "none",
                      verifyFormat: false,
                    }),
                  "Payload digest mismatch",
                );
              }
              mustFail(
                () =>
                  m.binary(row.packets.pair + "  ", { verifyFormat: false }),
                "Invalid payload length",
              );
              mustFail(
                () => m.binary(row.packets.windows),
                "Unsupported payload codec",
              );
              mustFail(
                () => m.warmup(["windows"]),
                "Unsupported payload codec",
              );
              mustFail(
                () => m.warmup(["pair"], [true]),
                "Unsupported memory optimization option",
              );
            }
            return cases;
          },
          { start: v.builds.length, rows: v.rows },
        );
        const warmed = await page.evaluate(
          ({ builds, rows }) => {
            let count = 0;
            for (let i = 0; i < builds.length; i++) {
              const b = builds[i],
                m = modules[i],
                row = rows.find(
                  (r) =>
                    r.kind === (b.core ? "none" : "secure") &&
                    r.rawHex.length === 514,
                );
              const first = m.binary(row.packets[b.packings[0]]); // lazy cold path
              if (m.warmup.length !== 2) throw Error("Warm-up signature");
              if (m.warmup() !== undefined) throw Error("Warm-up return value");
              m.warmup();
              for (const bad of ["pair", [...b.packings, "unknown"]]) {
                let failed = false;
                try {
                  m.warmup(bad);
                } catch {
                  failed = true;
                }
                if (!failed) throw Error("Invalid warm-up accepted");
              }
              for (const name of ["pair", "ans", "windows"].filter(
                (n) => !b.packings.includes(n),
              )) {
                let failed = false;
                try {
                  m.warmup([name]);
                } catch (e) {
                  failed = e.message === "Unsupported payload codec";
                }
                if (!failed) throw Error("Omitted warm-up codec accepted");
              }
              m.warmup([]);
              for (const name of b.packings) m.warmup([name]);
              m.warmup([...b.packings, ...b.packings]);
              m.warmup(
                b.packings,
                b.packings.map(() => false),
              );
              m.warmup(
                b.packings,
                b.packings.map((n) => (n === "pair" ? !b.core : true)),
              );
              for (const args of [
                [b.packings, []],
                [[], [false]],
                [b.packings, true],
                [b.packings, b.packings.map(() => 1)],
              ]) {
                let failed = false;
                try {
                  m.warmup(...args);
                } catch {
                  failed = true;
                }
                if (!failed) throw Error("Invalid memory flags accepted");
              }
              if (b.core && b.packings.includes("pair")) {
                let failed = false;
                try {
                  m.warmup(["pair"], [true]);
                } catch (e) {
                  failed =
                    e.message === "Unsupported memory optimization option";
                }
                if (!failed) throw Error("Omitted heavy strategy accepted");
              }
              if (
                Array.from(first, (x) => x.toString(16).padStart(2, "0")).join(
                  "",
                ) !== row.rawHex
              )
                throw Error("Warm-up changed output");
              for (const name of b.packings) {
                const out = m.binary(row.packets[name]);
                if (
                  Array.from(out, (x) => x.toString(16).padStart(2, "0")).join(
                    "",
                  ) !== row.rawHex
                )
                  throw Error("Warm decode bytes");
                count++;
              }
            }
            return count;
          },
          { builds: v.builds.map(({ source, wasm, ...b }) => b), rows: v.rows },
        );
        const official = await page.evaluate(
          ({ builds, answers }) => {
            let cases = 0;
            for (let i = 0; i < builds.length; i++) {
              const b = builds[i];
              if (b.core) continue;
              for (const name of ["ans", "windows"].filter((n) =>
                b.packings.includes(n),
              ))
                for (const a of answers) {
                  const out = modules[i].binary(a.packets[name]);
                  if (out.length !== a.size) throw Error("Official length");
                  for (let p = 0; p < out.length; p++)
                    if (out[p] !== p % 251) throw Error("Official bytes");
                  cases++;
                }
            }
            return cases;
          },
          {
            builds: v.builds.map(({ source, wasm, ...b }) => b),
            answers: v.official,
          },
        );
        const counts = await page.evaluate(
          ({ builds, rows, names, tags }) => {
            let positive = 0,
              unsupported = 0,
              rejected = 0;
            let oldBuffer;
            for (const row of rows)
              for (let bi = 0; bi < builds.length; bi++) {
                const b = builds[bi];
                if (b.core && row.kind !== "none") continue;
                for (const name of names) {
                  const text = row.packets[name];
                  if (text.charCodeAt(0) !== tags[name])
                    throw Error("Missing codec field");
                  if (!b.packings.includes(name)) {
                    // All unsupported checks run with BOTH validation
                    // mechanisms disabled when the build permits that.
                    if (row.mask === 0 && row.rawHex.length === 514) {
                      let error;
                      try {
                        modules[bi].binary(text, {
                          verifyFormat: false,
                          verifyData: "none",
                          memoryHeavy: true,
                        });
                      } catch (e) {
                        error = e.message;
                      }
                      if (error !== "Unsupported payload codec")
                        throw Error("Missing selection guard: " + error);
                      unsupported++;
                    }
                    continue;
                  }
                  for (const format of b.core ? [false] : [false, true])
                    for (const heavy of b.core ? [false] : [false, true]) {
                      if (row.reject) {
                        let error;
                        try {
                          modules[bi].binary(text, {
                            verifyFormat: format,
                            verifyData: row.kind,
                            memoryHeavy: heavy,
                          });
                        } catch (e) {
                          error = e.message;
                        }
                        if (
                          error !==
                          (row.kind === "fast"
                            ? "Payload checksum mismatch"
                            : "Payload digest mismatch")
                        )
                          throw Error("Stale digest guard: " + error);
                        rejected++;
                        continue;
                      }
                      const out = modules[bi].binary(text, {
                        verifyFormat: format,
                        verifyData: row.kind,
                        memoryHeavy: heavy,
                      });
                      const actual = Array.from(out, (b) =>
                        b.toString(16).padStart(2, "0"),
                      ).join("");
                      if (actual !== row.rawHex)
                        throw Error(name + " bytes " + row.rawHex.length / 2);
                      if (
                        out.byteOffset !== 0 ||
                        out.buffer.byteLength !==
                          out.length +
                            (row.kind === "secure"
                              ? 32
                              : row.kind === "fast"
                                ? 4
                                : 0)
                      )
                        throw Error("Ownership");
                      if (oldBuffer && oldBuffer.view[0] !== oldBuffer.first)
                        throw Error("Earlier output mutated");
                      if (out.length) oldBuffer = { view: out, first: out[0] };
                      positive++;
                      if (row.mask === 0 && row.rawHex.length === 514) {
                        for (const cut of [0, 1, 2]) {
                          let error;
                          try {
                            modules[bi].binary(text.slice(0, cut), {
                              verifyFormat: format,
                              verifyData: row.kind,
                              memoryHeavy: heavy,
                            });
                          } catch (e) {
                            error = e.message;
                          }
                          if (!error) throw Error("Short header accepted");
                          rejected++;
                        }
                      }
                    }
                  // Unmarked format 3 remains compatible ONLY with pair.
                  if (name === "pair" && !b.core && !row.reject) {
                    const out = modules[bi].binary(text.slice(1), {
                      verifyData: row.kind,
                    });
                    if (out.length !== row.rawHex.length / 2)
                      throw Error("Format-3 fallback");
                    positive++;
                  }
                }
              }
            return { positive, unsupported, rejected };
          },
          {
            builds: v.builds.map(({ source, wasm, ...b }) => b),
            rows: v.rows,
            names,
            tags,
          },
        );
        const full = v.builds.findIndex(
          (b) => b.packings.length === 3 && !b.core,
        );
        const large = await page.evaluate(
          async ({ items, full, origin }) => {
            let cases = 0;
            for (let i = 0; i < items.length; i++) {
              const raw = await (
                await fetch(origin + "/large/" + i)
              ).arrayBuffer();
              const text = new TextDecoder("utf-16le", {
                fatal: true,
                ignoreBOM: true,
              }).decode(raw);
              for (const verifyFormat of [false, true])
                for (const memoryHeavy of [false, true]) {
                  const out = modules[full].binary(text, {
                    verifyFormat,
                    verifyData: "secure",
                    memoryHeavy,
                  });
                  if (out.length !== items[i].size) throw Error("Large length");
                  for (let j = 0; j < out.length; j++)
                    if (out[j] !== ((j * 73 + 19) & 255))
                      throw Error("Large data");
                  cases++;
                }
            }
            return cases;
          },
          { items: v.large.map(({ file, ...i }) => i), full, origin },
        );
        let offline = 0;
        await page.route(/^https?:/, (route) => route.abort());
        for (const file of files) {
          await page.goto(require("node:url").pathToFileURL(file).href);
          await page.waitForFunction(() => globalThis.result, {
            timeout: 30000,
          });
          const result = await page.evaluate(() => globalThis.result);
          assert(result.pass, JSON.stringify(result));
          offline += result.cases;
        }
        results.push({
          browser: browser.version(),
          ...counts,
          large,
          offline,
          warmed,
          recommended,
          official,
        });
        console.log(JSON.stringify(results.at(-1)));
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  const report = {
    pass: true,
    directAbiCases: abi,
    warmupAbi,
    automaticAbi,
    results,
    sourceSha256: v.builds.map((b) =>
      crypto.createHash("sha256").update(b.source).digest("hex"),
    ),
    recommendedSha256: recommendedSources.map((s) =>
      crypto.createHash("sha256").update(s).digest("hex"),
    ),
  };
  fs.writeFileSync(
    path.join(root, "generated/codecs/results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
