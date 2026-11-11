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
  for (const b of v.builds) {
    const api = (await WebAssembly.instantiate(fs.readFileSync(b.wasm)))
      .instance.exports;
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
      const { binary } = await import(
        "data:text/javascript;base64," +
          Buffer.from(b.source).toString("base64")
      );
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
    const report = {
      pass: true,
      node: process.version,
      directAbiCases: abi,
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
          v.builds.map(
            (b) =>
              "data:text/javascript;base64," +
              Buffer.from(b.source).toString("base64"),
          ),
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
        results.push({ browser: browser.version(), ...counts, large, offline });
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
    results,
    sourceSha256: v.builds.map((b) =>
      crypto.createHash("sha256").update(b.source).digest("hex"),
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
