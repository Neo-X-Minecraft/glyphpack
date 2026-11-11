// 0BSD, NeoX. Validate the physical raw-script alphabets on both actual browsers.
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../.."),
  dir = path.join(root, "generated/transports"),
  m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json")));
const { pathToFileURL } = require("node:url");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
(async () => {
  const results = [];
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
      const p = await b.newPage();
      fs.writeFileSync(path.join(dir, "blank.html"), "<!doctype html>");
      await p.goto(pathToFileURL(path.join(dir, "blank.html")).href);
      await p.evaluate(
        async (urls) =>
          (globalThis.engines = await Promise.all(urls.map((u) => import(u)))),
        m.variants.map(
          (v) =>
            "data:text/javascript;base64," +
            fs.readFileSync(path.join(root, v.module)).toString("base64"),
        ),
      );
      let pass = 0,
        rejections = 0;
      for (const row of m.rows.filter(
        (r) =>
          r.kind === 2 &&
          ["empty", "random-1KiB", "decoder-wasm", "gzip-logs"].includes(
            r.dataset,
          ),
      )) {
        for (let i = 0; i < m.variants.length; i++) {
          const v = m.variants[i],
            text = fs
              .readFileSync(path.join(root, row.packets[v.packet].text))
              .toString("utf16le");
          const expected = sha(
            fs
              .readFileSync(path.join(root, row.expected))
              .subarray(0, row.bytes),
          );
          const result = await p.evaluate(
            async ({ text, i, size }) => {
              const out = engines[i].binary(text, 2);
              if (
                out.length !== size ||
                out.byteOffset !== 0 ||
                out.buffer.byteLength !== size + 32
              )
                throw Error("Ownership");
              const digest = new Uint8Array(
                await crypto.subtle.digest("SHA-256", out),
              );
              let rejected = 0;
              for (const cut of [0, 1, 2, 3, 5, text.length - 1]) {
                if (cut >= text.length) continue;
                let error;
                try {
                  engines[i].binary(text.slice(0, cut), 2);
                } catch (e) {
                  error = e.message;
                }
                if (!error) throw Error("Truncation");
                rejected++;
              }
              return {
                sha: Array.from(digest, (x) =>
                  x.toString(16).padStart(2, "0"),
                ).join(""),
                rejected,
              };
            },
            { text, i, size: row.bytes },
          );
          assert.equal(result.sha, expected);
          pass++;
          rejections += result.rejected;
        }
      }
      results.push({ browser: b.version(), pass, rejections });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await b.close();
    }
  }
  const hashes = Object.fromEntries(
    m.variants.map((v) => [
      v.name,
      sha(fs.readFileSync(path.join(root, v.module))),
    ]),
  );
  fs.writeFileSync(
    path.join(dir, "checks.json"),
    JSON.stringify({ pass: true, results, hashes }, null, 2) + "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
