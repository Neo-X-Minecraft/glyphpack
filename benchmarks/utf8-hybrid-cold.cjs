/* 0BSD, NeoX. Each first decode runs in a fresh browser process: no warm-up,
 * shared Wasm compilation cache, earlier decoder calls or correctness probes.
 * String transfer/browser launch are excluded; import + first decode included. */
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { chromium } = require("playwright"),
  http = require("node:http");
const root = path.resolve(__dirname, ".."),
  dest = path.join(root, "benchmarks/results/utf8-hybrid"),
  sha = (b) => crypto.createHash("sha256").update(b).digest("hex"),
  names = (
    process.env.HYBRID_COLD_VARIANTS ||
    "delivered,balanced,hybrid-utf8-high,stateless-utf8-high"
  ).split(","),
  runs = Number(process.env.HYBRID_COLD_RUNS || 3),
  manifest = require("../generated/utf8-prefix/manifest.json");
const rows = manifest.rows
  .filter(
    (r) => r.profile === 5 && ["random-1KiB", "random-1MiB"].includes(r.label),
  )
  .map((r) => ({
    ...r,
    text: fs.readFileSync(path.join(root, r.file), "utf8"),
    sha256: sha(fs.readFileSync(path.join(root, r.binary))),
  }));
const sources = names.map((name) => {
  const code = fs.readFileSync(
    path.join(root, "generated/utf8-speed", name + ".custom.mjs"),
  );
  return {
    name,
    url: "data:text/javascript;base64," + code.toString("base64"),
    sha256: sha(code),
    bytes: code.length,
  };
});
(async () => {
  const records = [],
    server = http.createServer((req, res) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.end("<!doctype html>");
    });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    for (const executablePath of [
      "/usr/bin/chromium",
      path.join(root, ".tools/chromium109/chromium"),
    ])
      for (let run = 1; run <= runs; run++)
        for (let i = 0; i < sources.length; i++)
          for (const row of rows) {
            const source = sources[(i + run - 1) % sources.length],
              browser = await chromium.launch({
                executablePath,
                headless: true,
                args: ["--no-sandbox"],
              });
            try {
              const p = await browser.newPage();
              await p.goto("http://127.0.0.1:" + server.address().port);
              const result = await p.evaluate(
                async ({ url, text }) => {
                  const begin = performance.now(),
                    m = await import(url),
                    loaded = performance.now(),
                    out = m.decode(text),
                    end = performance.now();
                  const digest = await crypto.subtle.digest("SHA-256", out);
                  return {
                    importMs: loaded - begin,
                    decodeMs: end - loaded,
                    totalMs: end - begin,
                    backend: m.backend || "js",
                    size: out.length,
                    sha256: Array.from(new Uint8Array(digest), (b) =>
                      b.toString(16).padStart(2, "0"),
                    ).join(""),
                  };
                },
                { url: source.url, text: row.text },
              );
              if (
                result.sha256 !== row.sha256 ||
                result.size !== row.inputBytes
              )
                throw Error("Cold bytes differ");
              records.push({
                browser: browser.version(),
                run,
                variant: source.name,
                label: row.label,
                ...result,
              });
              console.log(
                JSON.stringify({
                  browser: browser.version(),
                  run,
                  variant: source.name,
                  label: row.label,
                  totalMs: result.totalMs,
                }),
              );
            } finally {
              await browser.close();
            }
          }
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, "cold.json"),
      JSON.stringify(
        {
          scope:
            "Fresh browser per module/input, resident strings; import plus first decode; hash outside timer.",
          sources: sources.map(({ url, ...s }) => s),
          records,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
