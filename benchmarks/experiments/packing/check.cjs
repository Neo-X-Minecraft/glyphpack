// 0BSD, NeoX. Run the exact benchmark modules on both real target browsers.
// Include valid structurally encoded packets whose digest is deliberately stale.
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../.."),
  dir = path.join(root, "generated/packing");
const builds = JSON.parse(fs.readFileSync(path.join(dir, "builds.json")));
const vectors = JSON.parse(fs.readFileSync(path.join(dir, "vectors.json")));
(async () => {
  const results = [];
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
      const page = await browser.newPage();
      fs.writeFileSync(path.join(dir, "blank.html"), "<!doctype html>");
      await page.goto(pathToFileURL(path.join(dir, "blank.html")).href);
      await page.evaluate(
        async (urls) => {
          globalThis.engines = await Promise.all(urls.map((u) => import(u)));
        },
        builds.map(
          (b) =>
            "data:text/javascript;base64," +
            fs.readFileSync(path.join(root, b.module)).toString("base64"),
        ),
      );
      const result = await page.evaluate(
        ({ vectors, builds }) => {
          let positive = 0,
            negative = 0,
            headers = 0;
          for (const row of vectors)
            for (let i = 0; i < builds.length; i++) {
              const fn = engines[i].binary,
                text = row.packets[builds[i].packet];
              let bytes, error;
              try {
                bytes = fn(text, row.kind);
              } catch (e) {
                error = e.message;
              }
              if (row.reject) {
                if (!error)
                  throw Error("Accepted bad digest: " + builds[i].name);
                negative++;
                continue;
              }
              if (error)
                throw Error(
                  builds[i].name +
                    " n=" +
                    row.expectedHex.length / 2 +
                    " k=" +
                    row.kind +
                    " m=" +
                    row.mask +
                    ": " +
                    error,
                );
              const actual = Array.from(bytes, (b) =>
                b.toString(16).padStart(2, "0"),
              ).join("");
              if (actual !== row.expectedHex)
                throw Error(
                  "Wrong bytes: " +
                    builds[i].name +
                    " n=" +
                    row.expectedHex.length / 2,
                );
              if (
                bytes.byteOffset !== 0 ||
                bytes.buffer.byteLength !==
                  bytes.length + (row.kind === 2 ? 32 : row.kind === 1 ? 4 : 0)
              )
                throw Error("Ownership: " + builds[i].name);
              positive++;
              const replacement = text.indexOf(String.fromCharCode(65533));
              if (replacement >= 0) {
                const malformed =
                  text.slice(0, replacement) +
                  String.fromCharCode(55296) +
                  text.slice(replacement + 1);
                let rejected = false;
                try {
                  fn(malformed, row.kind);
                } catch {
                  rejected = true;
                }
                if (!rejected)
                  throw Error("Surrogate alias accepted: " + builds[i].name);
              }
              if (builds[i].packet !== "base64") {
                for (const cut of [0, 1, 2]) {
                  if (cut >= text.length) continue;
                  let failed = false;
                  try {
                    fn(text.slice(0, cut), row.kind);
                  } catch {
                    failed = true;
                  }
                  if (!failed)
                    throw Error("Accepted short header: " + builds[i].name);
                  headers++;
                }
              }
            }
          return { positive, negative, headers };
        },
        {
          vectors,
          builds: builds.map((b) => ({ name: b.name, packet: b.packet })),
        },
      );
      results.push({ browser: browser.version(), ...result });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await browser.close();
    }
  }
  const hashes = Object.fromEntries(
    builds.map((b) => [
      b.name,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, b.module)))
        .digest("hex"),
    ]),
  );
  fs.writeFileSync(
    path.join(dir, "correctness.json"),
    JSON.stringify({ pass: true, hashes, results }, null, 2) + "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
