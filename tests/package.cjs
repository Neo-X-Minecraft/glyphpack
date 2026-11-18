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
        /^(dist\/|docs\/|LICENSE$|README.md$|CHANGELOG.md$|package.json$)/.test(file.path),
        "Unexpected published file: " + file.path,
      );
    assert(packed.files.some((f) => f.path === "dist/full.min.d.mts"));
    assert(packed.files.some((f) => f.path === "docs/licenses/rust-library.html.gz"));
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
for(const name of ['glyphpack','glyphpack/high-memory']){const m=await import(name);m.warmup();check(m.binary(fixture.tagged.pair.secure));}
for(const name of ['glyphpack/core','glyphpack/none']){const m=await import(name);m.warmup();check(m.binary(fixture.tagged.pair.none));}
const {binary,warmup}=await import('glyphpack/full');warmup(['pair','ans','windows']);warmup([]);let cases=4;
for(const verifyData of ['none','fast','secure'])for(const verifyFormat of [false,true])for(const memoryHeavy of [false,true]){check(binary(fixture.tagged.pair[verifyData],{verifyData,verifyFormat,memoryHeavy}));cases++;}
const {binary:fast,warmup:warmFast}=await import('glyphpack/fast-none');warmFast();for(const verifyData of ['none','fast'])for(const verifyFormat of [false,true]){check(fast(fixture.tagged.pair[verifyData],{verifyData,verifyFormat}));cases++;}
for(const packing of ['pair','ans','windows','utf8','utf8-compact']){
 const name=packing==='pair'?'glyphpack':'glyphpack/'+packing, mod=await import(name), selected=mod.binary;
 assert.equal(mod.warmup.length,2);assert.equal(mod.warmup(),undefined);mod.warmup([packing],[false]);
 check(selected(fixture.tagged[packing].secure));cases++;
 for(const other of ['pair','ans','windows','utf8','utf8-compact'])if(other!==packing){assert.throws(()=>selected(fixture.tagged[other].secure),/Unsupported payload codec/);cases++;}
 for(const verifyData of ['none','fast','secure'])for(const verifyFormat of [false,true])for(const memoryHeavy of [false,true]){check(binary(fixture.tagged[packing][verifyData],{verifyData,verifyFormat,memoryHeavy}));cases++;}
}
for(const name of ['glyphpack/recommended','glyphpack/recommended-full']){
 const m=await import(name);m.warmup();const codecs=name.endsWith('recommended-full')?['pair','ans']:['pair'];
 m.warmup(codecs,codecs.map(()=>false));
 for(const codec of codecs){check(m.binary(fixture.tagged[codec].secure));cases++;assert.throws(()=>m.binary(fixture.tagged[codec].none,{verifyData:'none',verifyFormat:false}),/Required payload integrity mode missing/);cases++;}
 assert.throws(()=>m.binary(fixture.tagged.windows.secure),/Unsupported payload codec/);
 assert.throws(()=>m.binary(fixture.tagged.pair.secure+'  ',{verifyFormat:false,verifyData:'none'}),/Invalid payload/);
 assert.throws(()=>m.warmup(['pair'],[true]),/Unsupported memory optimization option/);
}
warmup(['ans','pair'],[true,false]);
const raw=await import('glyphpack/utf8-raw');raw.warmup();raw.warmup();
assert.deepEqual(raw.decode('~u2AAA'),new Uint8Array(0));
assert.deepEqual(raw.decode('~u2AABA@'),new Uint8Array([131]));
assert.throws(()=>raw.decode('~u2AAggggB'),/Invalid payload length/);cases+=3;
console.log(JSON.stringify({pass:true,node:process.version,cases,exports:13}));`;
    await fs.writeFile(path.join(temp, "consumer.mjs"), script);
    process.stdout.write(
      execFileSync(process.execPath, ["consumer.mjs"], {
        cwd: temp,
        encoding: "utf8",
      }),
    );
    // Resolve declarations from the installed archive, not the repository's
    // self-referencing package. Negative type assertions must still hold here.
    await fs.copyFile(
      path.join(root, "tests/types.mts"),
      path.join(temp, "types.mts"),
    );
    execFileSync(process.execPath, [
      require.resolve("typescript/bin/tsc"),
      "--noEmit", "--strict", "--module", "nodenext", "--target", "es2022",
      "types.mts",
    ], { cwd: temp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log("Installed package declarations passed.");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
