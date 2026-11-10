// Test the deployed layout (including its project prefix), worker round trips,
// real file downloads, and offline HTML. Encoding and hashes stay in Rust/Wasm.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../generated/pages");
const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};
async function main() {
  const server = http.createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (!name.startsWith("/glyphpack/")) {
        res.writeHead(404).end();
        return;
      }
      const file = path.resolve(
        root,
        name.slice("/glyphpack/".length) || "index.html",
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const bytes = await fs.readFile(file);
      res.setHeader(
        "Content-Type",
        types[path.extname(file)] || "application/octet-stream",
      );
      res.end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_BIN || undefined,
    args: ["--no-sandbox"],
  });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "glyphpack-site-"));
  try {
    const context = await browser.newContext({ acceptDownloads: true }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const base =
      process.env.SITE_URL ||
      `http://127.0.0.1:${server.address().port}/glyphpack/`;
    await page.goto(base);
    const idle = () =>
      page.waitForFunction(
        () => !document.getElementById("encode").disabled,
        {},
        { timeout: 60000 },
      );
    await idle();
    assert.match(await page.locator("#output").textContent(), /GlyphPack/);
    assert.equal(await page.locator("#integrity").inputValue(), "secure");
    assert.equal(await page.locator("#memory").isChecked(), false);
    for (const [id, title] of [
      ["unicode", "hello.txt"],
      ["svg", "chart.svg"],
      ["bytes", "all-bytes.bin"],
      ["gzip", "events.jsonl.gz"],
      ["empty", "empty.bin"],
      ["json", "settings.json"],
    ]) {
      await page.locator(`#examples [data-example="${id}"]`).click();
      await idle();
      assert.equal(await page.locator("#output-title").textContent(), title);
      if (id === "svg")
        assert.equal(
          await page.locator("#image-preview img").evaluate(
            (img) =>
              new Promise((resolve) => {
                if (img.complete) resolve(img.naturalWidth);
                else img.onload = () => resolve(img.naturalWidth);
              }),
          ),
          480,
        );
      if (id === "gzip") {
        await page.locator("#inflate").click();
        await idle();
        assert.match(
          await page.locator("#output").textContent(),
          /"sequence":99/,
        );
      }
      if (id === "empty")
        assert.match(
          await page.locator("#output").textContent(),
          /zero decoded bytes/,
        );
    }
    const text = "Local round trip: 世界 🌍\n</script><h1>literal text</h1>\n";
    // Cover every selectable format / integrity / lookup combination.
    for (const mode of ["none", "fast", "secure"])
      for (const format of [false, true])
        for (const memory of [false, true]) {
          await page.locator("#input").fill(text);
          await page.locator("#integrity").selectOption(mode);
          await idle();
          await page.locator("#format").setChecked(format);
          await page.locator("#memory").setChecked(memory);
          await page.locator("#encode").click();
          await idle();
          await page.locator("#decode").click();
          await idle();
          assert.equal(await page.locator("#output").textContent(), text);
          assert.equal(
            await page.locator("#status").evaluate((el) => el.className),
            "",
          );
        }
    async function download(id) {
      const event = page.waitForEvent("download");
      await page.locator("#" + id).click();
      const item = await event;
      const file = path.join(temp, item.suggestedFilename());
      await item.saveAs(file);
      await idle();
      return file;
    }
    // Exact UTF-16LE file round trip, including the no-BOM export.
    const packet = await download("download-payload");
    await page.locator("#payload-file").setInputFiles(packet);
    await idle();
    await page.locator("#decode").click();
    await idle();
    assert.equal(await page.locator("#output").textContent(), text);
    const bytes = await download("download-bytes");
    assert.equal(await fs.readFile(bytes, "utf8"), text);
    // Recovery keeps the good result and exports its successful policy/metadata.
    await page.locator("#payload").fill("bad");
    await page.locator("#decode").click();
    await idle();
    assert.match(
      await page.locator("#status").textContent(),
      /last successful result/,
    );
    assert.equal(await page.locator("#output").textContent(), text);
    await page.locator("#restore").click();
    await idle();
    assert.equal(
      await page.locator("#status").evaluate((el) => el.className),
      "",
    );
    const html = await download("download-html");
    const offline = await context.newPage();
    // An exported viewer must work without a server or any network requests.
    await offline.route(/^https?:/, (route) => route.abort());
    await offline.goto(pathToFileURL(html).href);
    await offline.waitForFunction(
      () => document.querySelector("h1").textContent !== "Loading…",
    );
    assert.equal(await offline.locator("pre").textContent(), text);
    await offline.close();
    // Binary files and browser-native gzip preserve every byte.
    const binary = Buffer.from(
      Array.from({ length: 65537 }, (_, i) => i & 255),
    );
    await page
      .locator("#file")
      .setInputFiles({
        name: "fixture.bin",
        mimeType: "application/octet-stream",
        buffer: binary,
      });
    await page.locator("#encode").click();
    await idle();
    assert.deepEqual(
      await fs.readFile(await download("download-bytes")),
      binary,
    );
    await page.locator("details.advanced").evaluate((el) => (el.open = true));
    await page.locator("#gzip").check();
    await page.locator("#effort").selectOption("full");
    await page.locator("#encode").click();
    await idle();
    await page.locator("#inflate").click();
    await idle();
    assert.deepEqual(
      await fs.readFile(await download("download-bytes")),
      binary,
    );
    await page.locator("#benchmark").click();
    await idle();
    assert.equal(await page.locator("#bench-result tbody tr").count(), 2);
    await page.locator("#run-checks").click();
    await idle();
    assert.equal(await page.locator("#checks-result .pass").count(), 4);
    assert.equal(await page.locator("#checks-result .error").count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "mobile page must not scroll horizontally",
    );
    await page.locator('#examples [data-example="svg"]').click();
    await idle();
    const svgHtml = await download("download-html"),
      svgPage = await context.newPage();
    await svgPage.route(/^https?:/, (route) => route.abort());
    await svgPage.goto(pathToFileURL(svgHtml).href);
    await svgPage.waitForFunction(
      () => document.querySelector("main img")?.naturalWidth === 480,
    );
    await svgPage.close();
    assert.deepEqual(errors, []);
    if (process.env.SITE_SCREENSHOT)
      await page.screenshot({
        path: process.env.SITE_SCREENSHOT,
        fullPage: true,
      });
    console.log(
      JSON.stringify({
        browser: await browser.version(),
        site: base,
        combinations: 12,
        examples: 6,
        checks: 4,
        offline: true,
        mobile: true,
      }),
    );
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
