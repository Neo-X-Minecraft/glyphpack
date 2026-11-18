// Examples are shipped in the web archive: run their actual imports and current
// packet literals so a format overhaul cannot silently leave broken samples.
const assert = require("node:assert/strict");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const root = path.resolve(__dirname, "..");
const expected = "Hello from GlyphPack. ✓";
for (const [name, count] of [["usage", 1], ["usage-none", 1], ["usage-full", 60]]) {
  const output = execFileSync(process.execPath, [`examples/${name}.mjs`], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = output.trim().split("\n");
  assert.equal(lines.length, count, name);
  for (const line of lines) assert(line.endsWith(expected), `${name}: wrong bytes`);
}
console.log("Examples passed: secure default, hashless pair, and 60 full-build combinations.");
