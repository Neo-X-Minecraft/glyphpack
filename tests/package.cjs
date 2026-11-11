// Exercise the package users actually install, with no source-tree imports or
// installed runtime dependencies. npm is used only to pack/install a local tar.
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, ".."),
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "glyphpack-package-"));
  const npm = (args, cwd) =>
    process.env.npm_execpath
      ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      : execFileSync("npm", args, {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
  try {
    const [packed] = JSON.parse(
      npm(
        ["pack", "--ignore-scripts", "--json", "--pack-destination", temp],
        root,
      ),
    );
    for (const file of packed.files)
      assert(
        /^(dist\/|docs\/|LICENSE$|README.md$|package.json$)/.test(file.path),
        "Unexpected published file: " + file.path,
      );
    assert(packed.files.some((f) => f.path === "dist/full.min.d.mts"));
    await fs.writeFile(
      path.join(temp, "package.json"),
      '{"private":true,"type":"module"}',
    );
    npm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        path.join(temp, packed.filename),
      ],
      temp,
    );
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(root, "tests/fixtures/package-packets.json"),
        "utf8",
      ),
    );
    const script = `import assert from 'node:assert/strict';
const fixture=${JSON.stringify(fixture)};
const check=bytes=>assert.equal(Buffer.from(bytes).toString('hex'),fixture.rawHex);
for(const name of ['glyphpack','glyphpack/high-memory']){const m=await import(name);m.warmup();check(m.binary(fixture.packets.secure));}
for(const name of ['glyphpack/core','glyphpack/none']){const m=await import(name);m.warmup();check(m.binary(fixture.packets.none));}
const {binary,warmup}=await import('glyphpack/full');warmup(['pair','ans','windows']);warmup([]);let cases=4;
for(const verifyData of ['none','fast','secure'])for(const verifyFormat of [false,true])for(const memoryHeavy of [false,true]){check(binary(fixture.packets[verifyData],{verifyData,verifyFormat,memoryHeavy}));cases++;}
const {binary:fast,warmup:warmFast}=await import('glyphpack/fast-none');warmFast();for(const verifyData of ['none','fast'])for(const verifyFormat of [false,true]){check(fast(fixture.packets[verifyData],{verifyData,verifyFormat}));cases++;}
for(const packing of ['pair','ans','windows']){
 const name=packing==='pair'?'glyphpack':'glyphpack/'+packing, mod=await import(name), selected=mod.binary;
 assert.equal(mod.warmup.length,0);assert.equal(mod.warmup(),undefined);mod.warmup();
 check(selected(fixture.tagged[packing].secure));cases++;
 for(const other of ['pair','ans','windows'])if(other!==packing){assert.throws(()=>selected(fixture.tagged[other].secure),/Unsupported payload codec/);cases++;}
 for(const verifyData of ['none','fast','secure'])for(const verifyFormat of [false,true])for(const memoryHeavy of [false,true]){check(binary(fixture.tagged[packing][verifyData],{verifyData,verifyFormat,memoryHeavy}));cases++;}
}
console.log(JSON.stringify({pass:true,node:process.version,cases,exports:8}));`;
    await fs.writeFile(path.join(temp, "consumer.mjs"), script);
    process.stdout.write(
      execFileSync(process.execPath, ["consumer.mjs"], {
        cwd: temp,
        encoding: "utf8",
      }),
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
