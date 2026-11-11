// 0BSD, NeoX. Fresh browser/profile for EVERY document. No cached Wasm instance
// or restored packet is supplied. The actual self-contained file does all work.
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../.."),
  dir = path.resolve(root, process.env.PACK_ROOT || "generated/packing"),
  docs = JSON.parse(fs.readFileSync(path.join(dir, "documents.json")));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const rounds = Number(process.env.PACK_ROUNDS || 3);
const browserConfigs = [
  {
    path: "/usr/bin/chromium",
    version: require("../../chromium.json").version,
  },
  {
    path: path.join(root, ".tools/chromium109/chromium"),
    version: "109.0.5414.119",
  },
].filter(
  (c) =>
    !process.env.PACK_BROWSERS ||
    process.env.PACK_BROWSERS.split(",").includes(c.version.split(".")[0]),
);
(async () => {
  const report = {
    pass: false,
    date: new Date().toISOString(),
    methodology: {
      rounds,
      scope:
        "actual self-contained HTML under file://; default BLAKE3 verification",
      included:
        "file read, document charset decoding, HTML/JS parsing, template restoration, gzip/base64 loader, Wasm instantiation, first decode and fresh output",
      excluded: "browser process launch and post-ready SHA-256 comparison",
      limits:
        "fresh browser/profile for each file; OS file cache may be warm; unpinned clocks and GC; few cold runs are descriptive",
    },
    documents: docs.map((d) => ({
      ...d,
      sha256: sha(fs.readFileSync(path.join(root, d.file))),
    })),
    rows: [],
  };
  for (const config of browserConfigs)
    for (let round = 0; round < rounds; round++) {
      for (let j = 0; j < docs.length; j++) {
        const doc = docs[(j + round * 5) % docs.length];
        const browser = await chromium.launch({
          headless: true,
          executablePath: config.path,
          args: ["--no-sandbox"],
        });
        assert.equal(browser.version(), config.version);
        try {
          const context = await browser.newContext();
          await context.setOffline(true);
          const page = await context.newPage(),
            errors = [],
            requests = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("request", (r) => {
            if (/^https?:/.test(r.url())) requests.push(r.url());
          });
          await page.goto(pathToFileURL(path.join(root, doc.file)).href, {
            timeout: 60000,
          });
          await page.waitForFunction(
            () => globalThis.packingLoad || globalThis.packingFailure,
            null,
            { timeout: 60000 },
          );
          const result = await page.evaluate(async () => {
            if (globalThis.packingFailure) return { error: packingFailure };
            const h = new Uint8Array(
              await crypto.subtle.digest("SHA-256", packingBytes),
            );
            return {
              ...packingLoad,
              marker: !!document.getElementById("end"),
              sha256: Array.from(h, (b) =>
                b.toString(16).padStart(2, "0"),
              ).join(""),
            };
          });
          assert(!result.error, doc.name + ": " + result.error);
          assert.equal(result.length, doc.bytes);
          assert.equal(result.protocol, "file:");
          assert.equal(result.charset.toLowerCase(), doc.encoding);
          assert(result.marker);
          assert.equal(requests.length, 0);
          assert.equal(errors.length, 0, errors.join("; "));
          const expected = fs
            .readFileSync(path.join(root, doc.expected))
            .subarray(0, doc.bytes);
          assert.equal(result.sha256, sha(expected));
          report.rows.push({
            browser: browser.version(),
            round: round + 1,
            name: doc.name,
            dataset: doc.dataset,
            bytes: doc.bytes,
            htmlBytes: doc.htmlBytes,
            networkRequests: requests.length,
            ...result,
          });
        } finally {
          await browser.close();
        }
      }
      console.log(
        JSON.stringify({
          browser: config.version,
          round: round + 1,
          documents: docs.length,
        }),
      );
    }
  report.pass = true;
  const output = process.env.PACK_COLD_OUTPUT || path.join(dir, "cold.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({ pass: true, cases: report.rows.length, file: output }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
