// 0BSD, NeoX. Validate actual files emitted by the experimental CLI, rather
// than assuming its flag parsing produces the already-benchmarked kernels.
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../..");
const files = [
  "compact-balanced.mjs",
  "compact-smallest.mjs",
  "compact-combined.mjs",
];
const rows = JSON.parse(
  fs.readFileSync(path.join(root, "generated/compact/vectors.json")),
).filter((r) => r.reject || [0, 2, 514, 8194].includes(r.rawHex.length));
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
      await p.evaluate(
        async (urls) =>
          (globalThis.cli = await Promise.all(urls.map((u) => import(u)))),
        files.map(
          (f) =>
            "data:text/javascript;base64," +
            fs.readFileSync(path.join(root, "generated", f)).toString("base64"),
        ),
      );
      const count = await p.evaluate((rows) => {
        let valid = 0,
          rejected = 0;
        for (const row of rows)
          for (let i = 0; i < cli.length; i++) {
            if (i < 2 && row.kind !== 2) continue;
            const choices =
              i === 0 ? ["ans4"] : i === 1 ? ["ans1"] : ["pair", "ans4"];
            for (const name of choices)
              for (const format of i === 2 ? [false, true] : [true])
                for (const heavy of i === 2 ? [false, true] : [false]) {
                  let result, error;
                  try {
                    result = cli[i].binary(row.packets[name], {
                      verifyFormat: format,
                      verifyData: ["none", "fast", "secure"][row.kind],
                      memoryHeavy: heavy,
                    });
                  } catch (e) {
                    error = e.message;
                  }
                  if (row.reject) {
                    if (
                      error !==
                      (row.kind === 1
                        ? "Payload checksum mismatch"
                        : "Payload digest mismatch")
                    )
                      throw Error("CLI integrity: " + error);
                    rejected++;
                    continue;
                  }
                  if (error) throw Error(error);
                  const hex = Array.from(result, (b) =>
                    b.toString(16).padStart(2, "0"),
                  ).join("");
                  if (hex !== row.rawHex) throw Error("CLI bytes");
                  if (
                    result.byteOffset !== 0 ||
                    result.buffer.byteLength !==
                      result.length +
                        (row.kind === 2 ? 32 : row.kind === 1 ? 4 : 0)
                  )
                    throw Error("CLI ownership");
                  valid++;
                }
          }
        return { valid, rejected };
      }, rows);
      results.push({ browser: b.version(), ...count });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await b.close();
    }
  }
  fs.writeFileSync(
    path.join(root, "generated/compact/cli-checks.json"),
    JSON.stringify({ pass: true, results }, null, 2) + "\n",
  );
  assert(results.every((r) => r.valid > 0 && r.rejected > 0));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
