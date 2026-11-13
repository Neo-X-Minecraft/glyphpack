/* 0BSD, NeoX. Check experimental kernels without affecting benchmark feedback.
 * SIMD is opt-in: the observed Chromium renderer crash is an exclusion result,
 * never a successful timing or a condition to hide behind a JS fallback. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/utf8-wasm"),
  out = path.join(root, "benchmarks/results/utf8-rival"),
  manifest = require("../generated/utf8-rival/manifest.json"),
  rows = require("../generated/utf8-wasm/builds.json"),
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
(async () => {
  const row = manifest.rows.find((r) => r.label === "random-1MiB"),
    text = fs.readFileSync(path.join(root, row.file), "utf8"),
    expected = sha(fs.readFileSync(path.join(root, row.binary))),
    records = [];
  for (const r of rows) {
    const m = await import(pathToFileURL(path.join(root, r.file)));
    for (const c of manifest.cases)
      assert.equal(
        Buffer.from(m.decode(c.text)).toString("hex"),
        c.hex,
        r.name,
      );
    assert.equal(sha(m.decode(text)), expected);
    records.push({
      name: r.name,
      vectors: manifest.cases.length,
      oneMiBSha256: expected,
      moduleSha256: sha(fs.readFileSync(path.join(root, r.file))),
    });
  }
  const result = { passed: true, runtime: process.version, records };
  fs.writeFileSync(
    path.join(out, "wasm-correctness.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  if (process.argv.includes("--simd")) {
    const r = rows.find((r) => r.name === "wasm-tokens-simd");
    assert(r, "Prepare with --simd first");
    const file = path.join(dir, "check.html");
    fs.writeFileSync(file, "<!doctype html>");
    const browser = await chromium.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const diagnostic = {
      browser: browser.version(),
      moduleSha256: sha(fs.readFileSync(path.join(root, r.file))),
    };
    try {
      const p = await browser.newPage();
      await p.goto(pathToFileURL(file).href);
      const actual = await p.evaluate(
        async ({ code, cases, text }) => {
          const m = await import("data:text/javascript;base64," + code);
          const hex = (b) =>
            Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
          for (const c of cases)
            if (hex(m.decode(c.text)) !== c.hex)
              throw Error("SIMD vector mismatch");
          return hex(
            new Uint8Array(
              await crypto.subtle.digest("SHA-256", m.decode(text)),
            ),
          );
        },
        {
          code: fs.readFileSync(path.join(root, r.file)).toString("base64"),
          cases: manifest.cases,
          text,
        },
      );
      assert.equal(actual, expected);
      diagnostic.accepted = true;
      diagnostic.oneMiBSha256 = actual;
    } catch (e) {
      diagnostic.accepted = false;
      diagnostic.error = e.message;
    } finally {
      await browser.close();
    }
    fs.writeFileSync(
      path.join(out, "simd-diagnostic.json"),
      JSON.stringify(diagnostic, null, 2) + "\n",
    );
    console.log(JSON.stringify(diagnostic));
  }
  console.log(
    JSON.stringify({
      passed: true,
      runtime: process.version,
      modules: records.length,
      vectorsPerModule: manifest.cases.length,
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
