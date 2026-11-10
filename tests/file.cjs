/* Run the actual self-contained module from file:// documents, offline and with
 * no file-access/web-security exceptions. Test both UTF-8 and UTF-16LE parsing. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  crypto = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  moduleFile = path.resolve(
    process.argv[2] || path.join(root, "dist/full.min.mjs"),
  );
const source = fs.readFileSync(moduleFile),
  vectors = JSON.parse(
    fs.readFileSync(path.join(root, "generated/test-vectors.json")),
  ).rows;
const folder = path.join(root, "generated/file-compat");
fs.mkdirSync(folder, { recursive: true });
const browsers = [
  {
    path: process.env.CHROMIUM_BIN || "/usr/bin/chromium",
    version:
      process.env.CHROMIUM_VERSION ||
      require("../benchmarks/chromium.json").version,
  },
];
const legacy =
  process.env.CHROMIUM109_BIN || path.join(root, ".tools/chromium109/chromium");
if (fs.existsSync(legacy)) browsers.push({ path: legacy, major: "109" });
const report = {
  pass: false,
  module: path.relative(root, moduleFile),
  moduleSha256: crypto.createHash("sha256").update(source).digest("hex"),
  legacyChecked: browsers.length > 1,
  rows: [],
};
(async () => {
  for (const browserConfig of browsers) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: browserConfig.path,
      args: ["--no-sandbox"],
    });
    try {
      if (browserConfig.version)
        assert.equal(browser.version(), browserConfig.version);
      else assert.equal(browser.version().split(".")[0], browserConfig.major);
      for (const encoding of ["utf8", "utf16le"]) {
        const html =
          '<!doctype html><meta charset="' +
          (encoding === "utf8" ? "utf-8" : "utf-16le") +
          '"><title>GlyphPack offline check</title><output>Loading</output><script type="module">\n' +
          'try {globalThis.fetch=()=>{throw Error("Unexpected fetch under file://")};const {binary}=await import("data:text/javascript;base64,' +
          source.toString("base64") +
          '");const rows=' +
          JSON.stringify(vectors) +
          ";let cases=0;" +
          'for(const row of rows)for(const verifyFormat of [false,true])for(const verifyData of ["none","fast","secure"])for(const memoryHeavy of [false,true]){const bytes=binary(row.packets[verifyData],{verifyFormat,verifyData,memoryHeavy});const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");if(hex!==row.rawHex)throw Error("Decoded bytes differ");if(bytes.byteOffset!==0||bytes.buffer.byteLength!==bytes.length+(verifyData==="secure"?32:verifyData==="fast"?4:0))throw Error("Buffer ownership differs");cases++;}globalThis.fileResult={pass:true,cases,protocol:location.protocol,isolated:crossOriginIsolated};document.querySelector("output").textContent="Passed";}catch(e){globalThis.fileResult={pass:false,error:e.message};}\n</script>';
        const file = path.join(
          folder,
          "check-" + browser.version().split(".")[0] + "-" + encoding + ".html",
        );
        fs.writeFileSync(
          file,
          encoding === "utf8"
            ? Buffer.from(html)
            : Buffer.from("\ufeff" + html, "utf16le"),
        );
        const context = await browser.newContext();
        await context.setOffline(true);
        const page = await context.newPage(),
          requests = [];
        page.on("request", (r) => {
          if (/^https?:/.test(r.url())) requests.push(r.url());
        });
        await page.goto(pathToFileURL(file).href);
        await page.waitForFunction(() => globalThis.fileResult, {
          timeout: 60000,
        });
        const result = await page.evaluate(() => fileResult);
        assert.equal(result.pass, true, result.error);
        assert.equal(result.protocol, "file:");
        assert.equal(requests.length, 0);
        report.rows.push({
          browser: browser.version(),
          encoding,
          ...result,
          networkRequests: requests.length,
        });
        await context.close();
      }
      if (!process.argv[2]) {
        const demo = path.join(root, "dist/standalone.html");
        assert(
          fs.existsSync(demo),
          "Build the standalone HTML with npm run build",
        );
        const context = await browser.newContext();
        await context.setOffline(true);
        await context.addInitScript(() => {
          globalThis.fetch = () => {
            throw Error("Unexpected standalone fetch");
          };
        });
        const page = await context.newPage(),
          requests = [];
        page.on("request", (r) => {
          if (/^https?:/.test(r.url())) requests.push(r.url());
        });
        await page.goto(pathToFileURL(demo).href);
        await page.waitForFunction(
          () =>
            document.querySelector("output")?.textContent ===
            "Hello from GlyphPack. ✓",
        );
        assert.equal(requests.length, 0);
        report.rows.push({
          browser: browser.version(),
          type: "ready-built-demo",
          pass: true,
          cases: 1,
          protocol: "file:",
          networkRequests: 0,
        });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  report.pass = true;
  fs.writeFileSync(
    path.join(root, "generated/file-compat.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
