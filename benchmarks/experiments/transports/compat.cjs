// 0BSD, NeoX. Probe document Unicode, reversible UTF-8 transcoding and the
// actual cost of escaping non-Windows-1252 page text. Browser orchestration only.
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../.."),
  dir = path.join(root, "generated/transports"),
  docs = JSON.parse(fs.readFileSync(path.join(dir, "documents.json")));
const decoder = new TextDecoder("windows-1252"),
  alphabet = decoder.decode(Uint8Array.from({ length: 256 }, (_, i) => i)),
  inverse = new Map(Array.from(alphabet, (c, i) => [c, i]));
const expected = "中文 🌍 €";
function single(text) {
  const bytes = [];
  for (const c of text) {
    if (!inverse.has(c)) throw Error("Unrepresentable source character");
    bytes.push(inverse.get(c));
  }
  return Buffer.from(bytes);
}
(async () => {
  const cases = [],
    rejections = [],
    transcodes = [];
  for (const doc of docs.filter((d) => d.dataset === "random-1KiB")) {
    const raw = fs.readFileSync(path.join(root, doc.file));
    const windows = doc.encoding === "windows-1252";
    const text = windows
      ? decoder.decode(raw)
      : raw.subarray(2).toString("utf16le");
    const title = windows ? "&#x4e2d;&#x6587; &#x1f30d; €" : expected;
    const literal = windows
      ? "\\u4e2d\\u6587 \\ud83c\\udf0d \\u20ac"
      : expected;
    const html = text
      .replace("<title>Matched transports</title>", `<title>${title}</title>`)
      .replace(
        "<script type=module>",
        `<script type=module>globalThis.unicodeProbe="${literal}";`,
      );
    const bytes = windows
      ? single(html)
      : Buffer.concat([Buffer.from([255, 254]), Buffer.from(html, "utf16le")]);
    const file = path.join(dir, doc.name + "-unicode.html");
    fs.writeFileSync(file, bytes);
    cases.push({
      name: doc.name,
      file,
      charset: doc.encoding,
      expectedLength: doc.bytes,
    });
    if (windows) {
      let rejected = false;
      try {
        single(text.replace("Matched transports", expected));
      } catch {
        rejected = true;
      }
      assert(rejected);
      rejections.push({ name: doc.name, literalUnicodeRejected: rejected });
      const utf8 = text.replace("charset=windows-1252", "charset=utf-8");
      const file = path.join(dir, doc.name + "-utf8.html");
      fs.writeFileSync(file, Buffer.from(utf8));
      cases.push({
        name: doc.name + "-utf8",
        file,
        charset: "utf-8",
        expectedLength: doc.bytes,
        plain: true,
      });
    }
  }
  for (const doc of docs.filter(
    (d) => d.encoding === "windows-1252" && d.dataset === "random-10MiB",
  )) {
    const raw = fs.readFileSync(path.join(root, doc.file)),
      utf8 = decoder
        .decode(raw)
        .replace("charset=windows-1252", "charset=utf-8");
    transcodes.push({
      name: doc.name,
      originalBytes: raw.length,
      utf8Bytes: Buffer.byteLength(utf8),
    });
  }
  const rows = [];
  for (const bin of [
    "/usr/bin/chromium",
    path.join(root, ".tools/chromium109/chromium"),
  ]) {
    const b = await chromium.launch({
      headless: true,
      executablePath: bin,
      args: ["--no-sandbox"],
    });
    try {
      for (const c of cases) {
        const p = await b.newPage();
        await p.context().setOffline(true);
        await p.goto(pathToFileURL(c.file).href);
        await p.waitForFunction(
          () => globalThis.packingLoad || globalThis.packingFailure,
        );
        const r = await p.evaluate(() => ({
          title: document.title,
          text: globalThis.unicodeProbe,
          length: globalThis.packingBytes?.length,
          error: globalThis.packingFailure,
          charset: document.characterSet,
        }));
        assert(!r.error, r.error);
        assert.equal(r.length, c.expectedLength);
        assert.equal(r.charset.toLowerCase(), c.charset);
        if (!c.plain) {
          assert.equal(r.title, expected);
          assert.equal(r.text, expected);
        }
        rows.push({ browser: b.version(), name: c.name, ...r });
        await p.close();
      }
    } finally {
      await b.close();
    }
  }
  fs.writeFileSync(
    path.join(dir, "compat.json"),
    JSON.stringify({ pass: true, rows, rejections, transcodes }, null, 2) +
      "\n",
  );
  console.log(JSON.stringify({ pass: true, checks: rows.length, transcodes }));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
