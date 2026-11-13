/* 0BSD, NeoX. Hybrid experiment: JS headers and lookup construction, one compact
 * Wasm body kernel. Build constants remove every unselected copy path. Exports
 * stay synchronous after ESM loading; unavailable Wasm uses the JS decoder. */
import { prepare, warmup as prepareWarmup } from "./prefix.mjs";
import { binary as javascript } from "./prefix-throughput.mjs";

let api = null,
  copiedTable = false,
  tokens;
try {
  if (typeof WebAssembly === "object") {
    let bytes = Uint8Array.from(atob(HYBRID_BINARY), (c) => c.charCodeAt(0));
    if (HYBRID_GZIP)
      bytes = new Uint8Array(
        await new Response(
          new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
      );
    api = (await WebAssembly.instantiate(bytes)).instance.exports;
  }
} catch {
  /* A disabled API/CSP takes the same synchronous JS fallback. */
}
export const backend = api ? "wasm" : "js";
const encoder =
  HYBRID_INPUT === "utf8" ? /* @__PURE__ */ new TextEncoder() : null;
function initialize(table) {
  if (!api || copiedTable) return;
  if (HYBRID_INPUT === "utf8" || HYBRID_INPUT === "utf16")
    new Int32Array(api.memory.buffer, api.table_ptr(), 2048).set(table);
  if (HYBRID_INPUT === "tokens") {
    tokens = new Uint16Array(2048);
    for (let c = 0; c < 2048; c++) {
      const e = table[c];
      if (e) tokens[c] = (1 << ((e >>> 16) & 15)) | (e & 32767);
    }
  }
  copiedTable = true;
}
export function warmup(profile = 5) {
  prepareWarmup(profile);
  initialize(prepare("~u1FAAA").table);
}
function check(status) {
  if (status)
    throw Error(
      status === 1
        ? "Invalid payload character"
        : status === 2
          ? "Invalid payload length"
          : "Invalid payload padding",
    );
}
export function decode(text) {
  if (!api) return javascript(text);
  const { table, mask, length, start } = prepare(text),
    chars = text.length - start;
  initialize(table);
  const input = api.begin(chars, HYBRID_CHUNK, mask);
  if (!input) return javascript(text);
  const slots = api.input_capacity(),
    stride = HYBRID_INPUT === "words" ? 4 : 2;
  // Reserve runs before creating views: memory.grow detaches old JS views.
  const view =
    HYBRID_INPUT === "utf8"
      ? new Uint8Array(api.memory.buffer, input, slots * 2)
      : HYBRID_INPUT === "words"
        ? new Int32Array(api.memory.buffer, input, slots)
        : new Uint16Array(api.memory.buffer, input, slots);
  let offset = start;
  while (offset < text.length) {
    const count = Math.min(slots, text.length - offset);
    if (HYBRID_INPUT === "utf8") {
      const { read, written } = encoder.encodeInto(
        text.slice(offset, offset + count),
        view,
      );
      // More than two UTF-8 bytes per UTF-16 unit proves an invalid alphabet
      // symbol. Reject it before the native arena guard, preserving precedence.
      if (read !== count || written > count * 2)
        throw Error("Invalid payload character");
      check(api.push(written));
    } else if (HYBRID_INPUT === "utf16") {
      for (let i = 0; i < count; i++) view[i] = text.charCodeAt(offset + i);
      check(api.push(count));
    } else if (HYBRID_INPUT === "words") {
      let valid = -1;
      for (let i = 0; i < count; i++) {
        const entry = table[text.charCodeAt(offset + i)];
        valid &= entry;
        view[i] = entry;
      }
      if (valid >= 0) throw Error("Invalid payload character");
      check(api.push(count));
    } else {
      let invalid = 0;
      for (let i = 0; i < count; i++) {
        const token = tokens[text.charCodeAt(offset + i)];
        invalid |= !token;
        view[i] = token;
      }
      if (invalid) throw Error("Invalid payload character");
      check(api.push(count));
    }
    offset += count;
  }
  check(api.finish(length));
  // Include the owned exact-size output copy in every warm decode timer.
  return new Uint8Array(api.memory.buffer, api.output_ptr(), length).slice();
}
