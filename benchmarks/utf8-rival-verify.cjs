/* 0BSD, NeoX. Correctness in separate browser processes from timing: malformed
 * inputs can change V8 feedback, so never benchmark after these negative tests. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  http = require("node:http"),
  { pathToFileURL } = require("node:url"),
  { execFileSync } = require("node:child_process"),
  esbuild = require("esbuild"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/utf8-rival"),
  dest = path.join(root, "benchmarks/results/utf8-rival"),
  manifest = require("../generated/utf8-rival/manifest.json"),
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  build = (source, format = "esm") =>
    esbuild.buildSync({
      stdin: { contents: source, resolveDir: root },
      bundle: true,
      write: false,
      minify: true,
      format,
      target: "chrome109",
    }).outputFiles[0].text,
  url = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64");
(async () => {
  const source = fs.readFileSync(
      path.join(root, "dist/utf8-raw.min.mjs"),
      "utf8",
    ),
    scalar = build(
      "export{decode}from './benchmarks/experiments/utf8-rival/scalar.mjs'",
    ),
    row = manifest.rows.find((r) => r.label === "random-1MiB"),
    expected = fs.readFileSync(path.join(root, row.binary)),
    packet = fs.readFileSync(path.join(root, row.file), "utf8");
  // Run the real Rust CLI for both a fixed mask and automatic mask selection.
  const cli = path.join(root, "target/release/examples/utf8_raw"),
    pages = [];
  for (const mask of ["zero", "auto"]) {
    const file = path.join(dir, "example-" + mask + ".html");
    execFileSync(
      cli,
      ["html", row.binary, file, ...(mask === "zero" ? ["--mask", "0"] : [])],
      { cwd: root },
    );
    pages.push({
      name: "native-" + mask,
      file,
      bytes: expected.length,
      sha256: sha(expected),
    });
  }
  for (const p of manifest.pages)
    pages.push({
      ...p,
      bytes: p.hex.length / 2,
      sha256: sha(Buffer.from(p.hex, "hex")),
      hex: undefined,
    });
  const large = fs.readFileSync(path.join(dir, "large.bin"));
  pages.push({
    name: "native-10MiB",
    file: path.join(dir, "large.html"),
    bytes: large.length,
    sha256: sha(large),
  });
  // Both the smallest and fastest tested Base122 decoder get complete files.
  const peer = fs.readFileSync(path.join(root, row.base122), "utf8");
  for (const [name, entry] of [
    [
      "base122-reference",
      "import{reference122 as decode}from './generated/encoding-comparison/reference122.mjs';globalThis.decode122=decode;",
    ],
    [
      "base122-groupUnroll",
      "import{groupUnroll as decode}from './benchmarks/experiments/utf8-rival/base122.mjs';globalThis.decode122=decode;",
    ],
  ]) {
    const code = build(entry, "iife"),
      file = path.join(dir, name + ".html"),
      escaped = peer.replace(/<(?=!--|\/?script)/gi, "\\x3c");
    fs.writeFileSync(
      file,
      "\ufeff<!doctype html><meta charset=utf-8><script>" +
        code +
        'globalThis.unpacked=decode122("' +
        escaped +
        '");</script>',
    );
    pages.push({ name, file, bytes: expected.length, sha256: sha(expected) });
  }
  for (const p of pages)
    new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(p.file));
  const letters = [];
  for (let c = 1; c < 128; c++)
    if (![0, 10, 13, 34, 38, 92].includes(c)) letters.push(c);
  letters.push(...require("../generated/utf8-rival/wide.json"));
  const browsers = [];
  for (const executablePath of [
    process.env.CHROMIUM_BIN || "/usr/bin/chromium",
    process.env.CHROMIUM109_BIN ||
      path.join(root, ".tools/chromium109/chromium"),
  ].filter((file, i) => i === 0 || fs.existsSync(file))) {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const context = await browser.newContext();
      await context.setOffline(true);
      await context.addInitScript(() => {
        globalThis.WebAssembly = undefined;
        globalThis.DecompressionStream = undefined;
        globalThis.fetch = () => {
          throw Error("Unexpected fetch");
        };
      });
      const page = await context.newPage();
      let requests = 0;
      page.on("request", (r) => {
        if (/^https?:/.test(r.url())) requests++;
      });
      for (const p of pages) {
        const errors = [];
        const handler = (e) => errors.push(e.message);
        page.on("pageerror", handler);
        await page.goto(pathToFileURL(p.file).href);
        page.off("pageerror", handler);
        assert.deepEqual(errors, []);
        const actual = await page.evaluate(async () => ({
          bytes: unpacked.length,
          sha256: Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", unpacked)),
            (b) => b.toString(16).padStart(2, "0"),
          ).join(""),
          charset: document.characterSet,
          wasm: typeof WebAssembly,
          decompression: typeof DecompressionStream,
          injected: !!globalThis.pwned,
        }));
        assert.equal(actual.bytes, p.bytes);
        assert.equal(actual.sha256, p.sha256);
        assert.equal(actual.charset, "UTF-8");
        assert.equal(actual.wasm, "undefined");
        assert.equal(actual.decompression, "undefined");
        assert.equal(actual.injected, false);
      }
      const checks = await page.evaluate(
        async ({ source, scalar, cases, letters }) => {
          const a = await import(source),
            b = await import(scalar),
            hex = (bytes) =>
              Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join(
                "",
              );
          let valid = 0,
            mutations = 0,
            rejected = 0;
          for (const c of cases) {
            if (
              hex(a.decode(c.text)) !== c.hex ||
              c.text.normalize("NFC") !== c.text
            )
              throw Error("Valid vector");
            valid++;
          }
          const outcome = (fn, text) => {
            try {
              return "ok:" + hex(fn(text));
            } catch (e) {
              return "err:" + e.message;
            }
          };
          for (let i = 0; i < cases.length; i += 7) {
            const s = cases[i].text;
            for (const t of [
              s.slice(0, -1),
              s + "A",
              s + "\0",
              s + "\r",
              s + "\u0080",
              s + "\u0300",
              s + "\ud800",
              s + "\u07ff",
              s + "\n",
              s + '"',
              s + "\\",
            ]) {
              const x = outcome(a.decode, t),
                y = outcome(b.decode, t);
              if (x !== y) throw Error("Differential mutation");
              if (x.startsWith("err:")) rejected++;
              mutations++;
            }
          }
          for (const s of [
            "",
            "~u2",
            "~u2AAA\0",
            "~u2A",
            "~u2AA",
            "~u2AAgggB",
            "~u2AAggggggB",
            "~u2AA____________",
            "~u2AEAA",
            "~u2AAggggggggA",
          ]) {
            if (!outcome(a.decode, s).startsWith("err:"))
              throw Error("Accepted malformed header");
            rejected++;
          }
          // Every ordered pair covers potential Unicode composition across symbols.
          const rows = [];
          for (const x of letters) {
            const row = [];
            for (const y of letters) row.push(x, y, 35);
            rows.push(String.fromCharCode(...row));
          }
          const text = rows.join("");
          if (text.normalize("NFC") !== text) throw Error("Normalization");
          // Exact owned buffers remain stable after later calls.
          const bytes = a.decode(cases.at(-1).text),
            before = hex(bytes);
          a.decode(cases[1].text);
          if (
            bytes.byteOffset ||
            bytes.buffer.byteLength !== bytes.length ||
            hex(bytes) !== before
          )
            throw Error("Output lifetime");
          return {
            valid,
            mutations,
            rejected,
            normalizationPairs: letters.length ** 2,
            ownedOutput: true,
          };
        },
        {
          source: url(source),
          scalar: url(scalar),
          cases: manifest.cases,
          letters,
        },
      );
      assert.equal(requests, 0);
      // UTF-8 BOM overrides an incorrectly declared HTTP encoding.
      const server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "text/html; charset=windows-1252");
        res.end(fs.readFileSync(pages[0].file));
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      let httpCharset;
      try {
        await context.setOffline(false);
        await page.goto("http://127.0.0.1:" + server.address().port);
        httpCharset = await page.evaluate(() => document.characterSet);
        assert.equal(httpCharset, "UTF-8");
        const hash = await page.evaluate(async () =>
          Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", unpacked)),
            (v) => v.toString(16).padStart(2, "0"),
          ).join(""),
        );
        assert.equal(hash, sha(expected));
      } finally {
        await new Promise((r) => server.close(r));
      }
      browsers.push({
        browser: browser.version(),
        ...checks,
        pages: pages.length,
        offlineNetworkRequests: 0,
        wasm: false,
        decompressionStream: false,
        httpCharset,
      });
    } finally {
      await browser.close();
    }
  }
  const result = {
    passed: true,
    browsers,
    module: { bytes: Buffer.byteLength(source), sha256: sha(source) },
    input: {
      bytes: expected.length,
      sha256: sha(expected),
      payloadBytes: Buffer.byteLength(packet),
      base122Bytes: Buffer.byteLength(peer),
    },
    pages: pages.map((p) => ({
      ...p,
      file: path.relative(root, p.file),
      htmlBytes: fs.statSync(p.file).size,
      htmlSha256: sha(fs.readFileSync(p.file)),
    })),
  };
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, "compatibility.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
