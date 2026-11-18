/* 0BSD, NeoX. Deliberately construct encoded markup transitions: putting HTML
 * in the input bytes alone does not exercise the serializer's escaping. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/integration/html-hostile"),
  cli = path.join(root, "target/release/glyphpack"),
  source = fs.readFileSync(path.join(root, "dist/full.min.mjs"), "utf8"),
  url = "data:text/javascript;base64," + Buffer.from(source).toString("base64"),
  digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  literal = (s) =>
    JSON.stringify(s).replace(
      /[<\u007f-\uffff]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
function varint(n) {
  let out = "";
  do {
    const d = n & 31;
    n >>>= 5;
    out += digits[d | (n ? 32 : 0)];
  } while (n);
  return out;
}
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const m = await import(url),
    pages = [],
    target = "</TeXtArEa><ScRiPt>globalThis.pwned=1</sCrIpT><!--<script>";
  let body = target;
  while (body.length % 8) body += "A";
  const raw = "~u2AA" + varint((body.length * 7) / 8) + body,
    bytes = m.binary("\x0b0" + raw, { verifyData: "none" }),
    input = path.join(dir, "fast.bin"),
    packet = path.join(dir, "fast.gp8");
  fs.writeFileSync(input, bytes);
  execFileSync(cli, [
    "encode",
    input,
    "--packing",
    "utf8",
    "--checksum",
    "none",
    "--mask",
    "0",
    "-o",
    packet,
  ]);
  assert.equal(
    fs.readFileSync(packet, "utf8"),
    "\x0b0" + raw,
    "Chosen bytes must produce the actual hostile text",
  );
  pages.push({
    name: "fast",
    packet,
    text: "\x0b0" + raw,
    hex: Buffer.from(bytes).toString("hex"),
  });
  // Compact's adaptive fast representation carries the same script guards.
  const adaptiveRaw = raw.replace(
      /<(?=\/?script|!--|\x01\x01\x01)/gi,
      "<\x01\x01\x01",
    ),
    adaptivePacket = path.join(dir, "adaptive.gp8");
  fs.writeFileSync(adaptivePacket, "\x0e0" + adaptiveRaw);
  pages.push({
    name: "adaptive",
    packet: adaptivePacket,
    text: "\x0e0" + adaptiveRaw,
    hex: Buffer.from(bytes).toString("hex"),
  });
  for (const p of pages) {
    const template = path.join(dir, p.name + ".template.html");
    p.file = path.join(dir, p.name + ".html");
    fs.writeFileSync(
      template,
      '<!doctype html><meta charset="__CHARSET__">__PAYLOAD__<script type="module">try{const u=URL.createObjectURL(new Blob([' +
        literal(source) +
        '],{type:"text/javascript"}));const m=await import(u);URL.revokeObjectURL(u);const text=document.getElementById("payload").textContent;const bytes=m.binary(text,{verifyData:"none"});globalThis.result={text,hex:Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")};}catch(e){globalThis.result={error:e.message};}</script>',
    );
    execFileSync(cli, ["inject", template, p.packet, p.file]);
  }
  for (const executablePath of process.env.CHROMIUM_BIN
    ? [process.env.CHROMIUM_BIN]
    : ["/usr/bin/chromium", path.join(root, ".tools/chromium109/chromium")]) {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const context = await browser.newContext();
      await context.setOffline(true);
      const page = await context.newPage();
      let network = 0;
      page.on("request", (r) => {
        if (/^https?:/.test(r.url())) network++;
      });
      for (const p of pages) {
        await page.goto(pathToFileURL(p.file).href);
        await page.waitForFunction(() => globalThis.result);
        const got = await page.evaluate(() => ({
          result,
          pwned: !!globalThis.pwned,
          charset: document.characterSet,
        }));
        assert(!got.result.error, got.result.error);
        assert.equal(got.result.text, p.text);
        assert.equal(got.result.hex, p.hex);
        assert.equal(got.pwned, false);
        assert.equal(got.charset, "UTF-8");
      }
      assert.equal(network, 0);
      console.log(
        JSON.stringify({
          browser: browser.version(),
          hostilePages: pages.length,
          network,
        }),
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
