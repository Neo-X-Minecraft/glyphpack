const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN || "/usr/bin/chromium",
    args: ["--no-sandbox"],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.evaluate(
      async (sources) => {
        window.engines = await Promise.all(
          sources.map(
            async (s) =>
              (await import("data:text/javascript;base64," + btoa(s))).api,
          ),
        );
        window.encode = (index, input, mode, exact) => {
          const api = engines[index],
            pointer = api.input_ptr(input.length);
          new Uint8Array(api.memory.buffer, pointer, input.length).set(input);
          if (api.encode(mode, +exact)) throw Error("encoder failure");
          const out = new Uint16Array(
            api.memory.buffer,
            api.output_ptr(),
            api.output_len(),
          );
          let text = "";
          for (let i = 0; i < out.length; i += 8192)
            text += String.fromCharCode(...out.subarray(i, i + 8192));
          return text;
        };
      },
      [
        process.argv[2] || "generated/baseline-v0.1.0/encoder.mjs",
        process.argv[3] || "generated/pages/encoder.mjs",
      ].map((p) => fs.readFileSync(p, "utf8")),
    );
    let seed = 833;
    const rows = [];
    for (const size of [65536, 1048576])
      for (const pattern of ["zero", "ff", "seq", "random"]) {
        const data = Array.from({ length: size }, (_, i) =>
          pattern === "zero"
            ? 0
            : pattern === "ff"
              ? 255
              : pattern === "seq"
                ? i & 255
                : ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
                  seed >>> 24),
        );
        const results = await page.evaluate(
          ({ data, size, pattern }) => {
            const input = new Uint8Array(data),
              rows = [];
            for (const mode of [0, 2])
              for (const exact of [false, true]) {
                if (
                  encode(0, input, mode, exact) !==
                  encode(1, input, mode, exact)
                )
                  throw Error("byte mismatch");
                const samples = [[], []];
                let sink = 0;
                for (let r = 0; r < 12; r++)
                  for (let j = 0; j < 2; j++) {
                    const k = (r + j) % 2,
                      start = performance.now(),
                      text = encode(k, input, mode, exact),
                      elapsed = performance.now() - start;
                    sink ^= text.charCodeAt(text.length - 1);
                    if (r >= 3) samples[k].push(elapsed);
                  }
                const center = samples.map(
                  (t) => t.slice().sort((a, b) => a - b)[4],
                );
                rows.push({
                  size,
                  pattern,
                  mode,
                  exact,
                  old_ms: center[0],
                  new_ms: center[1],
                  speedup: center[0] / center[1],
                  samples,
                  sink,
                });
              }
            return rows;
          },
          { data, size, pattern },
        );
        rows.push(...results);
        console.log(pattern, size);
      }
    fs.writeFileSync(
      process.argv[4] || "generated/results/encoder-browser.json",
      JSON.stringify(
        {
          browser: await browser.version(),
          date: new Date().toISOString(),
          methodology: {
            timed: "input bytes through Rust/Wasm to encoded JS string",
            warmups: 3,
            measured: 9,
            order: "alternate implementations each round",
            excluded:
              "module loading, input construction, correctness checks and structured cloning",
            limits: "one browser on an unpinned ARM64 host",
          },
          modules: [
            process.argv[2] || "generated/baseline-v0.1.0/encoder.mjs",
            process.argv[3] || "generated/pages/encoder.mjs",
          ].map((p) => ({
            path: p,
            sha256: require("node:crypto")
              .createHash("sha256")
              .update(fs.readFileSync(p))
              .digest("hex"),
          })),
          rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
