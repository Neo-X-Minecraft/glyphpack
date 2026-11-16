/* 0BSD, NeoX. Current packets only: 63 build choices, flags, corruption and
 * allocation limits. No predecessor-format decoder or packet is exercised. */
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  esbuild = require("esbuild");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const root = path.resolve(__dirname, ".."),
  v = isMainThread ? JSON.parse(
    fs.readFileSync(
      process.argv[2] || path.join(root, "generated/test-vectors.json"),
    ),
  ) : workerData.v,
  uri = (s) =>
    "data:text/javascript;base64," + Buffer.from(s).toString("base64");
(async () => {
  const oracleSource = isMainThread ? uri(
      esbuild.buildSync({
        entryPoints: [path.join(root, "tests/reference/pair.mjs")],
        bundle: true,
        write: false,
        format: "esm",
        target: "chrome109",
      }).outputFiles[0].text,
    ) : workerData.oracle;
  const oracle = await import(oracleSource);
  let roundTrips = 0,
    rejections = 0;
  for (const p of v.profiles) {
    if (isMainThread) {
      // ESM registries retain Wasm instances. Dispose a worker per profile,
      // bounding reserved Wasm address space independently of V8's GC policy.
      const stats = await new Promise((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: {
          oracle: oracleSource, v: { profiles: [p], rows: v.rows, zero: v.zero },
        } });
        let result;
        worker.once("message", value => { result = value; });
        worker.once("error", reject);
        worker.once("exit", code => {
          if (code === 0 && result) resolve(result);
          else reject(Error("Profile worker failed: " + code));
        });
      });
      roundTrips += stats.roundTrips;
      rejections += stats.rejections;
      continue;
    }
    const { binary } = await import(uri(p.source)),
      defaultMode = p.modes.at(-1);
    for (const row of v.rows)
      for (const verifyFormat of p.formats)
        for (const verifyData of p.modes)
          for (const memoryHeavy of p.memories) {
            const options = { verifyFormat, verifyData, memoryHeavy },
              bytes = binary(row.packets[verifyData], options);
            assert.equal(Buffer.from(bytes).toString("hex"), row.rawHex);
            assert.equal(
              Buffer.from(
                oracle.binary(row.packets[verifyData], options),
              ).toString("hex"),
              row.rawHex,
            );
            roundTrips++;
          }
    for (const verifyFormat of p.formats)
      for (const verifyData of p.modes)
        for (const memoryHeavy of p.memories) {
          const options = { verifyFormat, verifyData, memoryHeavy };
          for (const text of ["", "\t", "\t ", "unrecognized identifier"]) {
            assert.throws(() => binary(text, options));
            rejections++;
          }
          if (verifyData !== "none") {
            assert.throws(
              () => binary(v.zero.none, options),
              /integrity mode missing/,
            );
            rejections++;
          }
        }
    if (p.formats.length === 2)
      assert.throws(
        () => binary(v.zero[defaultMode], { verifyFormat: "false" }),
        /Unsupported format verification option/,
      );
    if (p.memories.length === 2)
      assert.throws(
        () => binary(v.zero[defaultMode], { memoryHeavy: "false" }),
        /Unsupported memory optimization option/,
      );
    if (p.modes.length > 1)
      assert.throws(
        () => binary(v.zero[defaultMode], { verifyData: "unknown" }),
        /Unsupported data verification mode/,
      );
  }
  if (!isMainThread) {
    parentPort.postMessage({ roundTrips, rejections });
    return;
  }
  const profile = v.profiles.find(
      (p) =>
        p.formats.length === 2 &&
        p.modes.length === 3 &&
        p.memories.length === 2,
    ),
    { binary } = await import(uri(profile.source));
  let seed = 331;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  let mutations = 0;
  for (let k = 0; k < 10000; k++) {
    const r = v.rows[random(v.rows.length)],
      mode = ["fast", "secure"][random(2)];
    let text = r.packets[mode],
      pos = random(text.length);
    text =
      text.slice(0, pos) +
      String.fromCharCode(random(65536)) +
      text.slice(pos + 1);
    for (const memoryHeavy of [false, true]) {
      try {
        const b = binary(text, { verifyData: mode, memoryHeavy });
        assert.equal(Buffer.from(b).toString("hex"), r.rawHex);
      } catch (e) {
        if (e.code === "ERR_ASSERTION") throw e;
      }
      mutations++;
    }
  }
  console.log(
    JSON.stringify({
      pass: true,
      profiles: v.profiles.length,
      roundTrips,
      rejections,
      mutations,
      currentFormatOnly: true,
    }),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
