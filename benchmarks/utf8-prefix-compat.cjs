/* 0BSD, NeoX. Exercise delivered ESM/classic builds, quoted literal contexts,
 * UTF-8 file bytes, normalization, malformed input and no-Wasm execution. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  http = require("node:http"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/utf8-prefix"),
  out = path.join(root, "benchmarks/results/utf8-prefix"),
  sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
(async () => {
  const core = await import(pathToFileURL(path.join(dir, "decoder.min.mjs"))),
    full = await import(pathToFileURL(path.join(dir, "decoder-full.min.mjs"))),
    manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"))),
    classic = fs.readFileSync(path.join(dir, "decoder.iife.js"), "utf8"),
    ranges = JSON.parse(
      fs.readFileSync(path.join(dir, "portable-ranges.json")),
    );
  let positive = 0,
    rejected = 0;
  for (const c of manifest.cases) {
    assert.deepEqual(
      Buffer.from(full.decode(c.text)),
      Buffer.from(c.hex, "hex"),
    );
    positive++;
    if (c.text[3] === "F") {
      assert.equal(c.text.normalize("NFC"), c.text);
      assert.deepEqual(
        Buffer.from(core.decode(c.text)),
        Buffer.from(c.hex, "hex"),
      );
      positive++;
    }
  }
  for (const c of manifest.cases
    .filter((c) => c.text[3] === "F")
    .filter((_, i) => i % 19 === 0)) {
    for (const text of [
      c.text.slice(0, -1),
      c.text + "A",
      c.text + "\0",
      c.text + "\r",
      c.text + "<",
      c.text + "\u0080",
      c.text + "\u0300",
      c.text + "\ud800",
    ]) {
      assert.throws(() => core.decode(text));
      rejected++;
    }
  }
  for (const text of [
    "",
    "~u1FAA",
    "~u1FAAg",
    "~u1FAA______",
    "~u1FAAggggggggA",
  ]) {
    assert.throws(() => core.decode(text));
    rejected++;
  }
  assert.throws(
    () => core.decode(manifest.cases.find((c) => c.text[3] === "E").text),
    /Unsupported UTF-8 profile/,
  );
  const portable = manifest.rows.find(
      (r) => r.label === "random-1MiB" && r.profile === 5,
    ),
    text = fs.readFileSync(path.join(root, portable.file), "utf8"),
    expected = fs.readFileSync(path.join(root, portable.binary));
  const letters = [];
  for (let c = 1; c < 128; c++)
    if (![0, 10, 13, 34, 36, 39, 60, 92, 96, 127].includes(c)) letters.push(c);
  const pool = ranges.flatMap(([a, b]) =>
    Array.from({ length: b - a }, (_, i) => a + i),
  );
  letters.push(...pool.slice(0, 1540));
  const alphabet = String.fromCharCode(...letters),
    contexts = {
      data: (s) =>
        "<script type=x id=p>" +
        s +
        '</script><script>globalThis.unpacked=document.getElementById("p").textContent;</script>',
      single: (s) => "<script>globalThis.unpacked='" + s + "';</script>",
      double: (s) => '<script>globalThis.unpacked="' + s + '";</script>',
      template: (s) => "<script>globalThis.unpacked=`" + s + "`;</script>",
    };
  const pages = [];
  for (const [context, write] of Object.entries(contexts))
    for (const probe of [true, false]) {
      const raw = probe ? alphabet : text;
      let html = "<!doctype html><meta charset=utf-8>" + write(raw);
      if (!probe)
        html +=
          "<script>" +
          classic +
          "globalThis.unpacked=UTF8Prefix.decode(globalThis.unpacked);</script>";
      const file = path.join(
        dir,
        "compat-" + context + "-" + (probe ? "alphabet" : "packet") + ".html",
      );
      fs.writeFileSync(file, html);
      new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
      const bytes = probe ? Buffer.from(alphabet) : expected;
      pages.push({
        file,
        context,
        probe,
        bytes: bytes.length,
        sha256: sha(bytes),
      });
    }
  pages.push({
    file: path.join(dir, "example.html"),
    context: "actual-native-html",
    probe: false,
    bytes: expected.length,
    sha256: sha(expected),
  });
  const peers = fs.readFileSync(
    path.join(root, "generated/encoding-comparison/random-1MiB-none.base122"),
    "utf8",
  );
  const peerCode = esbuild.buildSync({
    stdin: {
      contents:
        "import{block122}from './benchmarks/fixtures/encoding-competitors.js';globalThis.decode122=block122;",
      resolveDir: root,
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "iife",
    minify: true,
    target: "chrome109",
  }).outputFiles[0].text;
  const peerHtml =
    "\ufeff<!doctype html><meta charset=utf-8><script>" +
    peerCode +
    'globalThis.unpacked=decode122("' +
    peers.replace(/<(?=\/script|!--)/gi, "\\x3c") +
    '");</script>';
  const baselineFile = path.join(dir, "base122.html");
  fs.writeFileSync(baselineFile, peerHtml);
  pages.push({
    file: baselineFile,
    context: "base122-complete-file",
    probe: false,
    bytes: expected.length,
    sha256: sha(expected),
  });
  const baselineSizes = [
    { implementation: "block122", bytes: Buffer.byteLength(peerHtml) },
  ];
  for (const [name, entry] of [
    [
      "inline122",
      "import{inline122 as f}from './benchmarks/fixtures/encoding-competitors.js';globalThis.decode122=f;",
    ],
    [
      "reference122",
      "import{reference122 as f}from './generated/encoding-comparison/reference122.mjs';globalThis.decode122=f;",
    ],
  ]) {
    const code = esbuild.buildSync({
      stdin: { contents: entry, resolveDir: root, loader: "js" },
      bundle: true,
      write: false,
      format: "iife",
      minify: true,
      target: "chrome109",
    }).outputFiles[0].text;
    const html =
      "\ufeff<!doctype html><meta charset=utf-8><script>" +
      code +
      'globalThis.unpacked=decode122("' +
      peers.replace(/<(?=\/script|!--)/gi, "\\x3c") +
      '");</script>';
    const file = path.join(dir, "base122-" + name + ".html");
    fs.writeFileSync(file, html);
    pages.push({
      file,
      context: name,
      probe: false,
      bytes: expected.length,
      sha256: sha(expected),
    });
    baselineSizes.push({
      implementation: name,
      bytes: Buffer.byteLength(html),
    });
  }
  const browsers = [];
  if (
    fs.existsSync(path.join(dir, "large.html")) &&
    fs.existsSync(path.join(dir, "large.bin"))
  ) {
    const data = fs.readFileSync(path.join(dir, "large.bin"));
    pages.push({
      file: path.join(dir, "large.html"),
      context: "large-native-html",
      probe: false,
      bytes: data.length,
      sha256: sha(data),
    });
  }
  for (const executablePath of [
    process.env.CHROMIUM_BIN || "/usr/bin/chromium",
    process.env.CHROMIUM109_BIN ||
      path.join(root, ".tools/chromium109/chromium"),
  ].filter((f, i) => i === 0 || fs.existsSync(f))) {
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
        const error = (e) => errors.push(e.message);
        page.on("pageerror", error);
        await page.goto(pathToFileURL(p.file).href);
        page.off("pageerror", error);
        assert.deepEqual(errors, []);
        const actual = await page.evaluate(async () => {
          const data =
              typeof unpacked === "string"
                ? new TextEncoder().encode(unpacked)
                : unpacked,
            hash = await crypto.subtle.digest("SHA-256", data);
          return {
            bytes: data.length,
            sha256: Array.from(new Uint8Array(hash), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
            charset: document.characterSet,
            wasm: typeof WebAssembly,
            decompression: typeof DecompressionStream,
          };
        });
        assert.equal(actual.bytes, p.bytes);
        assert.equal(actual.sha256, p.sha256);
        assert.equal(actual.charset, "UTF-8");
        assert.equal(actual.wasm, "undefined");
        assert.equal(actual.decompression, "undefined");
      }
      const normalization = await page.evaluate((letters) => {
        const rows = [];
        for (const a of letters) {
          const row = [];
          for (const b of letters) row.push(a, b, 35);
          rows.push(String.fromCharCode(...row));
        }
        const s = rows.join("");
        return { pairs: letters.length ** 2, stable: s.normalize("NFC") === s };
      }, letters);
      assert.equal(normalization.stable, true);
      assert.equal(requests, 0);
      // A UTF-8 BOM on the native HTML also survives a mislabelled HTTP charset.
      const server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "text/html; charset=windows-1252");
        res.end(fs.readFileSync(path.join(dir, "example.html")));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      let mislabelledHttp;
      try {
        await context.setOffline(false);
        await page.goto("http://127.0.0.1:" + server.address().port);
        mislabelledHttp = await page.evaluate(async () => {
          const hash = await crypto.subtle.digest("SHA-256", unpacked);
          return {
            bytes: unpacked.length,
            sha256: Array.from(new Uint8Array(hash), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join(""),
            charset: document.characterSet,
          };
        });
        assert.equal(mislabelledHttp.bytes, expected.length);
        assert.equal(mislabelledHttp.sha256, sha(expected));
        assert.equal(mislabelledHttp.charset, "UTF-8");
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
      browsers.push({
        browser: browser.version(),
        pages: pages.length,
        protocol: "file:",
        offline: true,
        networkRequests: 0,
        wasm: false,
        decompressionStream: false,
        normalization,
        mislabelledHttp,
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }
  const result = {
    passed: true,
    positive,
    rejected,
    browsers,
    builds: ["decoder.min.mjs", "decoder-full.min.mjs", "decoder.iife.js"].map(
      (file) => ({
        file,
        bytes: fs.statSync(path.join(dir, file)).size,
        sha256: sha(fs.readFileSync(path.join(dir, file))),
      }),
    ),
    html: {
      prefixBytes: fs.statSync(path.join(dir, "example.html")).size,
      base122Bytes: Buffer.byteLength(peerHtml),
      prefixSha256: sha(fs.readFileSync(path.join(dir, "example.html"))),
      base122Sha256: sha(peerHtml),
      baselines: baselineSizes,
    },
    alphabet: {
      ascii: 118,
      multibyte: 1540,
      scope:
        "No NUL, CR/LF, DEL/C1, quotes, backslash, backtick, dollar, less-than, marks, format characters, unassigned characters or supplementary scalars; frozen assigned alphabet is NFC-stable",
    },
  };
  fs.writeFileSync(
    path.join(out, "compatibility.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
