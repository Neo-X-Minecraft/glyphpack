// 0BSD, NeoX. Matched-kernel correctness, policy matrix and rejection controls.
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  { chromium } = require("playwright");
const root = path.resolve(__dirname, "../../.."),
  dir = path.join(root, "generated/compact");
const builds = JSON.parse(fs.readFileSync(path.join(dir, "builds.json"))),
  vectors = JSON.parse(fs.readFileSync(path.join(dir, "vectors.json")));
const names = ["pair", "ans4", "ans1", "ans2", "ans8", "ans-low"];
(async () => {
  const results = [];
  for (const bin of [
    "/usr/bin/chromium",
    path.join(root, ".tools/chromium109/chromium"),
  ]) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: bin,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.evaluate(
        async (urls) =>
          (globalThis.engines = await Promise.all(urls.map((u) => import(u)))),
        builds.map(
          (v) =>
            "data:text/javascript;base64," +
            fs.readFileSync(path.join(root, v.module)).toString("base64"),
        ),
      );
      const counts = await page.evaluate(
        ({ builds, vectors, names }) => {
          const profileName = {
            ans4: "ans4",
            ans1: "ans1",
            ans2: "ans2",
            ans8: "ans8",
            "ans-low": "ans-low",
          };
          let positive = 0,
            rejected = 0,
            unselected = 0,
            policyCases = 0;
          function throws(fn, label) {
            let error;
            try {
              fn();
            } catch (e) {
              error = e.message;
            }
            if (!error) throw Error("Accepted " + label);
            rejected++;
          }
          for (const row of vectors)
            for (let bi = 0; bi < builds.length; bi++) {
              const build = builds[bi],
                fn = engines[bi].binary;
              if (!build.kinds.includes(row.kind)) continue;
              const formats =
                build.name === "all" ? build.formats : [build.formats.at(-1)];
              const memories = build.name === "all" ? build.memories : [false];
              for (const name of names) {
                const supported = build.features.includes(
                  name === "pair" ? "pair" : profileName[name],
                );
                const text = row.packets[name];
                if (!supported) {
                  // One bounded representative for each policy; no
                  // absent transport is allowed to fall through.
                  if (
                    row.mask === 0 &&
                    row.rawHex.length === 514 &&
                    !(build.name === "pair-control-core" && row.kind === 0)
                  ) {
                    throws(
                      () => fn(text, row.kind),
                      "unselected " + build.name + "/" + name,
                    );
                    unselected++;
                  }
                  continue;
                }
                for (const format of formats)
                  for (const memory of memories) {
                    if (row.reject) {
                      let error;
                      try {
                        fn(text, row.kind, format, memory);
                      } catch (e) {
                        error = e.message;
                      }
                      if (
                        error !==
                        (row.kind === 1
                          ? "Payload checksum mismatch"
                          : "Payload digest mismatch")
                      )
                        throw Error(
                          "Stale digest was not independently rejected: " +
                            build.name +
                            "/" +
                            name +
                            ": " +
                            error,
                        );
                      rejected++;
                      continue;
                    }
                    const bytes = fn(text, row.kind, format, memory);
                    const hex = Array.from(bytes, (b) =>
                      b.toString(16).padStart(2, "0"),
                    ).join("");
                    if (hex !== row.rawHex)
                      throw Error(
                        "Wrong bytes: " +
                          build.name +
                          "/" +
                          name +
                          " n=" +
                          row.rawHex.length / 2,
                      );
                    if (
                      bytes.byteOffset !== 0 ||
                      bytes.buffer.byteLength !==
                        bytes.length +
                          (row.kind === 2 ? 32 : row.kind === 1 ? 4 : 0)
                    )
                      throw Error("Output ownership");
                    positive++;
                    if (build.name === "all") policyCases++;
                    if (row.mask === 0 && row.rawHex.length === 514) {
                      for (const cut of [0, 1, 2, 3, text.length - 1]) {
                        if (cut >= text.length) continue;
                        // The existing unchecked pair path permits
                        // noncanonical tails; mandatory header and
                        // allocation guards still apply to it.
                        if (
                          cut > 3 &&
                          !format &&
                          row.kind === 0 &&
                          name === "pair"
                        )
                          continue;
                        throws(
                          () =>
                            fn(text.slice(0, cut), row.kind, format, memory),
                          "truncated " + build.name + "/" + name,
                        );
                      }
                      // Invalid characters may be deliberately ignored
                      // only when both mechanisms are disabled.
                      if (format || row.kind !== 0) {
                        const bad = text.slice(0, 3) + "<" + text.slice(4);
                        throws(
                          () => fn(bad, row.kind, format, memory),
                          "invalid character",
                        );
                      }
                    }
                  }
              }
            }
          // Structural length guards apply to all unchecked paths. This
          // allocates at most a tiny header string, never the declared MB.
          const all = engines[builds.findIndex((b) => b.name === "all")].binary;
          const alpha = [];
          for (let c = 32; c < 65534; c++)
            if (
              c !== 60 &&
              !(c >= 127 && c <= 159) &&
              !(c >= 55296 && c <= 57343) &&
              !(c >= 64976 && c <= 65007) &&
              ![65279, 8232, 8233].includes(c)
            )
              alpha.push(c);
          for (const kind of [0, 1, 2])
            for (const format of [false, true])
              for (const heavy of [false, true]) {
                for (const code of [32768, 33792, 34816, 35840, 36864, 37888]) {
                  const header = String.fromCharCode(
                    alpha[code + (kind << 8)],
                    alpha[2000000 % 63385],
                    alpha[Math.floor(2000000 / 63385)],
                  );
                  throws(
                    () => all(header, kind, format, heavy),
                    "allocation amplification",
                  );
                }
              }
          return { positive, rejected, unselected, policyCases };
        },
        { builds, vectors, names },
      );
      results.push({ browser: browser.version(), ...counts });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await browser.close();
    }
  }
  const hashes = Object.fromEntries(
    builds.map((v) => [
      v.name,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, v.module)))
        .digest("hex"),
    ]),
  );
  fs.writeFileSync(
    path.join(dir, "checks.json"),
    JSON.stringify({ pass: true, hashes, results }, null, 2) + "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
