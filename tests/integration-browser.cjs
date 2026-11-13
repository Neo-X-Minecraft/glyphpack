/* 0BSD, NeoX. Browser dispatch/verification plus real native HTML serializers.
 * These checks run separately from performance so malformed strings cannot
 * contaminate JIT feedback. No screenshot or visual inspection is required. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  { execFileSync } = require("node:child_process"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/integration"),
  v = require("../generated/integration/vectors.json"),
  cli = path.join(root, "target/release/glyphpack"),
  names = ["pair", "ans", "windows", "utf8", "utf8-compact"],
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  url = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64"),
  literal = (s) =>
    JSON.stringify(s).replace(
      /[\u007f-\uffff<]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
const source = fs.readFileSync(path.join(root, "dist/full.min.mjs"), "utf8");
function program(ids, mode) {
  return `<script type="module">try{const u=URL.createObjectURL(new Blob([${literal(source)}],{type:'text/javascript'}));const m=await import(u);URL.revokeObjectURL(u);globalThis.result=[];for(const id of ${JSON.stringify(ids)}){const text=document.getElementById(id).textContent;const b=m.binary(text,{verifyData:${JSON.stringify(mode)}});result.push({id,text,hex:Array.from(b,v=>v.toString(16).padStart(2,'0')).join('')});}}catch(e){globalThis.result={error:e.message};}</script>`;
}
function buildPages() {
  const sample = v.rows.find(
      (r) => r.mode === "secure" && r.mask === 0 && r.hex.length === 514,
    ),
    input = path.join(dir, "html-input.bin");
  fs.writeFileSync(input, Buffer.from(sample.hex, "hex"));
  const pages = [],
    fragments = [];
  for (const name of names) {
    const packet = path.join(dir, `html-${name}.gp`),
      template = path.join(dir, `html-${name}.template.html`),
      file = path.join(dir, `html-${name}.html`);
    execFileSync(cli, [
      "encode",
      input,
      "--packing",
      name,
      "--mask",
      "0",
      "-o",
      packet,
    ]);
    fs.writeFileSync(
      template,
      '<!doctype html><meta charset="__CHARSET__">__PAYLOAD__' +
        program(["payload"], "secure"),
    );
    execFileSync(cli, [
      "inject",
      template,
      packet,
      file,
      ...(name === "windows" ? ["--encoding", "windows1252"] : []),
    ]);
    pages.push({ name, file, hex: sample.hex, text: sample.packets[name] });
    const bytes = fs.readFileSync(file),
      html = new TextDecoder(
        name === "windows"
          ? "windows-1252"
          : name.startsWith("utf8")
            ? "utf-8"
            : "utf-16le",
      ).decode(bytes),
      match = html.match(
        /<(script|textarea)\b[^>]*\bid="payload"[^>]*>[\s\S]*?<\/\1>/i,
      );
    assert(match, "Missing data element " + name);
    fragments.push(match[0].replace('id="payload"', `id="${name}"`));
  }
  const mixed = path.join(dir, "mixed.html");
  fs.writeFileSync(
    mixed,
    "\ufeff<!doctype html><meta charset=utf-8>" +
      fragments.join("") +
      program(names, "secure"),
  );
  pages.push({
    name: "mixed",
    file: mixed,
    hex: sample.hex,
    texts: sample.packets,
  });
  return pages;
}
(async () => {
  const pages = buildPages(),
    results = [];
  for (const executablePath of process.env.CHROMIUM_BIN
    ? [process.env.CHROMIUM_BIN]
    : ["/usr/bin/chromium", path.join(root, ".tools/chromium109/chromium")]) {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      let comparisons = 0,
        rejections = 0;
      // Fresh contexts release module-scoped compact tables between build subsets.
      for (const b of v.builds) {
        const context = await browser.newContext(),
          p = await context.newPage();
        try {
          await p.goto(pathToFileURL(pages[0].file).href);
          await p.waitForFunction(() => globalThis.result);
          const got = await p.evaluate(
            async ({ code, build, rows, corrupt }) => {
              const m = await import(code),
                hex = (b) =>
                  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join(
                    "",
                  );
              let comparisons = 0,
                rejections = 0;
              m.warmup();
              m.warmup(
                build.packings,
                build.packings.map(() => false),
              );
              for (const row of rows)
                for (const [packing, text] of Object.entries(row.packets)) {
                  if (!build.packings.includes(packing)) {
                    try {
                      m.binary(text, { verifyData: build.data.at(-1) });
                      throw Error("Accepted omitted codec");
                    } catch (e) {
                      if (e.message !== "Unsupported payload codec") throw e;
                      rejections++;
                    }
                    continue;
                  }
                  if (!build.data.includes(row.mode)) continue;
                  for (const verifyFormat of build.format)
                    for (const memoryHeavy of build.memory
                      ? [false, true]
                      : [false]) {
                      if (
                        hex(
                          m.binary(text, {
                            verifyData: row.mode,
                            verifyFormat,
                            memoryHeavy,
                          }),
                        ) !== row.hex
                      )
                        throw Error("Decoded bytes");
                      comparisons++;
                    }
                }
              for (const row of corrupt)
                if (
                  build.packings.includes(row.packing) &&
                  build.data.includes(row.mode)
                )
                  for (const verifyFormat of build.format) {
                    try {
                      m.binary(row.text, {
                        verifyData: row.mode,
                        verifyFormat,
                      });
                      throw Error("Accepted corruption");
                    } catch (e) {
                      if (
                        e.message !==
                        (row.mode === "fast"
                          ? "Payload checksum mismatch"
                          : "Payload digest mismatch")
                      )
                        throw e;
                      rejections++;
                    }
                  }
              return { comparisons, rejections };
            },
            {
              code: url(fs.readFileSync(b.file)),
              build: b,
              rows: v.rows.filter((r) => r.mask === 0 && r.hex.length <= 514),
              corrupt: v.corrupt,
            },
          );
          comparisons += got.comparisons;
          rejections += got.rejections;
        } finally {
          await context.close();
        }
      }
      const context = await browser.newContext();
      await context.setOffline(true);
      const p = await context.newPage();
      let network = 0;
      p.on("request", (r) => {
        if (/^https?:/.test(r.url())) network++;
      });
      for (const page of pages) {
        await p.goto(pathToFileURL(page.file).href);
        await p.waitForFunction(() => globalThis.result);
        const got = await p.evaluate(() => ({
          result,
          charset: document.characterSet,
          pwned: !!globalThis.pwned,
        }));
        assert(!got.result.error, got.result.error);
        assert.equal(got.pwned, false);
        for (const r of got.result) {
          assert.equal(r.hex, page.hex);
          assert.equal(r.text, page.text || page.texts[r.id]);
        }
        assert.equal(
          got.charset,
          page.name === "windows"
            ? "windows-1252"
            : page.name === "pair" || page.name === "ans"
              ? "UTF-16LE"
              : "UTF-8",
        );
      }
      // Every compact size/cost and the original fast byte stream recover 1 MiB.
      const large = await p.evaluate(
        async ({ code, packets, expected }) => {
          const m = await import(code),
            rows = [];
          for (const row of packets) {
            const bytes = m.binary(row.text, { verifyData: row.mode }),
              digest = await crypto.subtle.digest("SHA-256", bytes);
            rows.push({
              packing: row.packing,
              mode: row.mode,
              bytes: bytes.length,
              sha: Array.from(new Uint8Array(digest), (v) =>
                v.toString(16).padStart(2, "0"),
              ).join(""),
            });
          }
          return rows;
        },
        {
          code: url(source),
          packets: v.large.map((r) => ({
            ...r,
            text: fs.readFileSync(r.file, "utf8"),
          })),
        },
      );
      const expected = sha(fs.readFileSync(v.input));
      for (const row of large) {
        assert.equal(row.bytes, 1048576);
        assert.equal(row.sha, expected);
      }
      assert.equal(network, 0);
      await context.close();
      results.push({
        browser: browser.version(),
        builds: v.builds.length,
        comparisons,
        rejections,
        offlinePages: pages.length,
        largeCases: large.length,
        network,
      });
    } finally {
      await browser.close();
    }
  }
  fs.mkdirSync(path.join(dir, "results"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "results/browser.json"),
    JSON.stringify({ passed: true, results }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ passed: true, results }));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
