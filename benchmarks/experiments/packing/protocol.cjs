// 0BSD, NeoX. Transport charset precedence is a compatibility decision, not a
// speed benchmark. Test correct/absent/incorrect HTTP charset declarations.
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../.."),
  dir = path.join(root, "generated/packing");
const docs = JSON.parse(
  fs.readFileSync(path.join(dir, "documents.json")),
).filter((d) => d.dataset === "random-1KiB");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
(async () => {
  let active;
  const server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", active.header);
    res.end(fs.readFileSync(path.join(root, active.doc.file)));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const rows = [];
  try {
    for (const binary of [
      "/usr/bin/chromium",
      path.join(root, ".tools/chromium109/chromium"),
    ]) {
      const browser = await chromium.launch({
        headless: true,
        executablePath: binary,
        args: ["--no-sandbox"],
      });
      try {
        for (const doc of docs)
          for (const declaration of ["correct", "absent", "utf8"]) {
            console.log(
              JSON.stringify({
                browser: browser.version(),
                name: doc.name,
                declaration,
              }),
            );
            active = {
              doc,
              header:
                "text/html" +
                (declaration === "absent"
                  ? ""
                  : "; charset=" +
                    (declaration === "correct" ? doc.encoding : "utf-8")),
            };
            const page = await browser.newPage(),
              errors = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.goto(
              "http://127.0.0.1:" + server.address().port + "/page",
              { timeout: 60000 },
            );
            const shouldPass = !(
              doc.encoding === "windows-1252" && declaration === "utf8"
            );
            if (shouldPass)
              try {
                await page.waitForFunction(
                  () => globalThis.packingBytes || globalThis.packingFailure,
                  null,
                  { timeout: 5000 },
                );
              } catch (e) {
                throw Error(
                  JSON.stringify({
                    name: doc.name,
                    declaration,
                    errors,
                    state: await page.evaluate(() => ({
                      charset: document.characterSet,
                      failure: globalThis.packingFailure,
                      marker: !!document.getElementById("end"),
                    })),
                  }),
                  { cause: e },
                );
              }
            const r = await page.evaluate(async () => {
              const out = globalThis.packingBytes;
              if (!out)
                return {
                  charset: document.characterSet,
                  error: globalThis.packingFailure || "No decoded output",
                };
              const h = new Uint8Array(
                await crypto.subtle.digest("SHA-256", out),
              );
              return {
                charset: document.characterSet,
                sha256: Array.from(h, (b) =>
                  b.toString(16).padStart(2, "0"),
                ).join(""),
              };
            });
            const expected = sha(
              fs
                .readFileSync(path.join(root, doc.expected))
                .subarray(0, doc.bytes),
            );
            const exact = r.sha256 === expected;
            assert.equal(
              exact,
              shouldPass,
              doc.name +
                "/" +
                declaration +
                ": " +
                JSON.stringify({ r, errors }),
            );
            rows.push({
              browser: browser.version(),
              name: doc.name,
              declaration,
              exact,
              expectedPass: shouldPass,
              ...r,
              errors,
            });
            await page.close();
          }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  fs.writeFileSync(
    path.join(dir, "protocol.json"),
    JSON.stringify({ pass: true, rows }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ pass: true, cases: rows.length }));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
