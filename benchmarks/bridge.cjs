/* 0BSD, NeoX. Generate isolated UTF-16 bridge candidates over one identical
 * Wasm kernel. These modules are measurement fixtures, not distributions. */
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "generated/optimization");
const runtime = fs
  .readFileSync(path.join(root, "src/decoder/wasm-runtime.js"), "utf8")
  .replace(/PAYLOAD_[A-Z_]+/g, (c) =>
    c === "PAYLOAD_LEGACY" ? "false" : "true",
  );
const start = runtime.indexOf("  if (littleEndian) {"),
  end = runtime.indexOf("  const status = api.decode", start);
if (start < 0 || end < 0) throw Error("Bridge anchors changed");
const otherwise = runtime.slice(runtime.indexOf("  } else {", start), end);
const variants = {
  u16: runtime.slice(start, end),
  unroll: `  if(littleEndian){const input=new Uint16Array(api.memory.buffer,pointer,length);let i=0;for(;i+3<length;i+=4){input[i]=text.charCodeAt(i);input[i+1]=text.charCodeAt(i+1);input[i+2]=text.charCodeAt(i+2);input[i+3]=text.charCodeAt(i+3);}for(;i<length;i++)input[i]=text.charCodeAt(i);\n${otherwise}`,
  u32: `  if(littleEndian){const input=new Uint32Array(api.memory.buffer,pointer,length>>>1);let i=0;for(;i+1<length;i+=2)input[i>>>1]=text.charCodeAt(i)|(text.charCodeAt(i+1)<<16);if(length&1)new Uint16Array(api.memory.buffer,pointer,length)[i]=text.charCodeAt(i);\n${otherwise}`,
  cache: `  if(littleEndian){const buffer=api.memory.buffer;if(buffer!==cachedBuffer||pointer!==cachedPointer){cachedBuffer=buffer;cachedPointer=pointer;cachedInput=new Uint16Array(buffer,pointer);}for(let i=0;i<length;i++)cachedInput[i]=text.charCodeAt(i);\n${otherwise}`,
};
const raw = fs.readFileSync(
  process.argv[2] || path.join(dir, "full-default-baseline.wasm"),
);
const suffix = `\nconst raw=Uint8Array.from(atob(${JSON.stringify(raw.toString("base64"))}),c=>c.charCodeAt(0));const api=(await WebAssembly.instantiate(raw)).instance.exports;export function binary(text){return runWasm(api,text,true,2,false);}export function warmup(){warmWasm(api,7,0);}\n`;
const file = path.join(dir, "candidates.json"),
  manifest = JSON.parse(fs.readFileSync(file));
manifest.rows = manifest.rows.filter((r) => !r.variant.startsWith("bridge-"));
for (const [name, copy] of Object.entries(variants)) {
  const source =
      (name === "cache"
        ? "let cachedBuffer,cachedPointer,cachedInput;\n"
        : "") +
      runtime.slice(0, start) +
      copy +
      runtime.slice(end) +
      suffix,
    module = path.join(dir, `bridge-${name}.mjs`);
  fs.writeFileSync(module, source);
  manifest.rows.push({
    profile: "full",
    variant: "bridge-" + name,
    module: path.relative(root, module),
    moduleBytes: Buffer.byteLength(source),
    scope:
      "bridge-only, raw kernel embedding excluded from file-size comparisons",
  });
}
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
