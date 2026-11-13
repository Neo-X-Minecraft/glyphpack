/* 0BSD, NeoX. Offline/native/fallback checks plus malformed data spanning the
 * 4/32/64 KiB transfer boundaries. Fixtures are public synthetic bytes. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { pathToFileURL } = require("node:url"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."),
  work = path.join(root, "generated/utf8-hybrid"),
  dest = path.join(root, "benchmarks/results/utf8-hybrid"),
  names = [
    "hybrid-words-scalar-4096",
    "hybrid-words-high-32768",
    "hybrid-utf8-scalar-32768",
    "hybrid-utf8-high",
    "stateless-utf8-high",
    "string-length",
    "hybrid-words-scalar-4096-gzip",
  ],
  manifest = require("../generated/utf8-prefix/manifest.json"),
  row = manifest.rows.find((r) => r.profile === 5 && r.label === "random-1MiB"),
  text = fs.readFileSync(path.join(root, row.file), "utf8"),
  expected = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, row.binary)))
    .digest("hex"),
  uri = (code) =>
    "data:text/javascript;base64," + Buffer.from(code).toString("base64"),
  sources = names.map((name) => ({
    name,
    url: uri(
      fs.readFileSync(
        path.join(root, "generated/utf8-speed", name + ".custom.mjs"),
      ),
    ),
  })),
  reference = uri(
    fs.readFileSync(path.join(root, "generated/utf8-prefix/decoder.min.mjs")),
  );
fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(work, "empty.html"), "<!doctype html>");
(async () => {
  const records = [];
  for (const bin of [
    "/usr/bin/chromium",
    path.join(root, ".tools/chromium109/chromium"),
  ]) {
    const browser = await chromium.launch({
      executablePath: bin,
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      for (const s of sources)
        for (const mode of [
          "native",
          "disabled",
          ...(s.name.endsWith("-gzip") ? ["gzip-disabled"] : []),
        ]) {
          const disabled = mode === "disabled";
          const file = path.join(
            work,
            "offline-" + s.name + "-" + mode + ".html",
          );
          fs.writeFileSync(
            file,
            "\ufeff<!doctype html><meta charset=utf-8>" +
              (disabled
                ? "<script>globalThis.WebAssembly=undefined;</script>"
                : "") +
              (mode !== "native"
                ? "<script>globalThis.DecompressionStream=undefined;</script>"
                : "") +
              '<script>globalThis.fetch=()=>{throw Error("Runtime network disabled")}</script><script type=module>try{const m=await import(' +
              JSON.stringify(s.url) +
              ');const bytes=m.decode("' +
              text +
              '");m.decode("~u1FAAA");globalThis.result={backend:m.backend,bytes:bytes.length,owned:bytes.byteOffset===0&&bytes.buffer.byteLength===bytes.length,sha:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("")}}catch(e){globalThis.result={error:e.message}}</script>',
          );
          const p = await browser.newPage();
          let network = 0;
          p.on("request", (r) => {
            if (/^https?:/.test(r.url())) network++;
          });
          await p.goto(pathToFileURL(file).href);
          await p.waitForFunction(() => globalThis.result);
          const got = await p.evaluate(() => globalThis.result);
          if (
            got.sha !== expected ||
            !got.owned ||
            network ||
            (mode !== "native" && got.backend !== "js")
          )
            throw Error(
              "Offline " +
                JSON.stringify({ s: s.name, disabled, got, network }),
            );
          records.push({
            browser: browser.version(),
            name: s.name,
            disabled,
            mode,
            network,
            ...got,
          });
          await p.close();
        }
      const p = await browser.newPage();
      await p.goto(pathToFileURL(path.join(work, "empty.html")).href);
      const boundaries = await p.evaluate(
        async ({ sources, reference, text }) => {
          const ref = (await import(reference)).decode,
            modules = await Promise.all(sources.map((s) => import(s.url))),
            start = (() => {
              let i = 6;
              while (
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(
                  text[i++],
                ) & 32
              ) {}
              return i;
            })(),
            cases = [];
          for (const at of [
            4095,
            4096,
            4097,
            32767,
            32768,
            32769,
            65535,
            65536,
            65537,
            text.length - start - 1,
          ])
            for (const cp of ["\u0300", "\ud800"])
              cases.push(
                text.slice(0, start + at) + cp + text.slice(start + at + 1),
              );
          cases.push(
            text.slice(0, -1),
            text + "A",
            text + "\0",
            text.slice(0, 6) + "A" + text.slice(start),
          );
          const error = (fn, t) => {
            try {
              fn(t);
              return "success";
            } catch (e) {
              return e.message;
            }
          };
          let comparisons = 0;
          for (const t of cases) {
            const wanted = error(ref, t);
            for (const m of modules) {
              if (error(m.decode, t) !== wanted)
                throw Error("Boundary error mismatch");
              comparisons++;
            }
          }
          return comparisons;
        },
        { sources, reference, text },
      );
      records.push({
        browser: browser.version(),
        boundaryErrorComparisons: boundaries,
      });
      await p.close();
    } finally {
      await browser.close();
    }
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, "compatibility.json"),
    JSON.stringify({ passed: true, records }, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: true,
      offlinePages: records.filter((r) => r.name).length,
      boundaryComparisons: records.reduce(
        (n, r) => n + (r.boundaryErrorComparisons || 0),
        0,
      ),
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
