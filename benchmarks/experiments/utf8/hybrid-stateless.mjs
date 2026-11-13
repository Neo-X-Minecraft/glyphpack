/* 0BSD, NeoX. One synchronous Wasm call with JS-managed arena and optional
 * complete finite-state lookup. Only the selected implementation is bundled. */
import { prepare, warmup as baseWarmup } from "./prefix.mjs";
import { binary as javascript } from "./prefix-throughput.mjs";
let memory, api;
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
    memory = new WebAssembly.Memory({ initial: HYBRID_FSM ? 34 : 2 });
    api = new WebAssembly.Instance(
      new WebAssembly.Module(
        bytes,
        HYBRID_INPUT === "jsstring" ? { builtins: ["js-string"] } : {},
      ),
      {
        env: { memory },
      },
    ).exports;
  }
} catch {
  /* The exact JS implementation remains the compatibility fallback. */
}
export const backend = api ? "wasm" : "js";
const encoder = HYBRID_INPUT === "utf8" && api ? new TextEncoder() : null;
let initialized = false;
function initialize(table) {
  if (!api || initialized) return;
  if (HYBRID_FSM) {
    const transitions = new Uint32Array(memory.buffer, 32768, 256 * 2048);
    for (let bits = 0; bits < 8; bits++)
      for (let carry = 0; carry < 1 << bits; carry++) {
        const state = (1 << bits) | carry;
        for (let c = 0; c < 2048; c++) {
          const e = table[c];
          if (!e) continue;
          const w = (e >>> 16) & 15,
            q = (carry << w) | (e & 32767),
            total = bits + w,
            advance = total >>> 3,
            pending = total & 7,
            next = (1 << pending) | (q & ((1 << pending) - 1)),
            a = advance ? (q >>> (total - 8)) & 255 : 0,
            b = advance === 2 ? (q >>> (total - 16)) & 255 : 0;
          transitions[state * 2048 + c] =
            a |
            (b << 8) |
            (next << 16) |
            (advance << 24) |
            (w << 26) |
            0x80000000;
        }
      }
  } else if (
    HYBRID_INPUT === "utf16" ||
    HYBRID_INPUT === "jsstring" ||
    HYBRID_INPUT === "utf8"
  )
    new Int32Array(memory.buffer, 32768, 2048).set(table);
  initialized = true;
  if (typeof HYBRID_PRIME !== "undefined" && HYBRID_PRIME)
    for (let i = 0; i < HYBRID_PRIME; i++)
      if (HYBRID_INPUT === "jsstring") api.decode("", 0, 0, 65536, 0, 0);
      else api.decode(65536, 0, 65536, 0, 0);
}
export function warmup(profile = 5) {
  baseWarmup(profile);
  initialize(prepare("~u1FAAA").table);
}
export function decode(text) {
  if (!api || (HYBRID_INPUT === "jsstring" && typeof text !== "string"))
    return javascript(text);
  const { table, mask, length, start } = prepare(text),
    count = text.length - start;
  if (count > 1 << 27) return javascript(text);
  initialize(table);
  const cap = 2 ** Math.ceil(Math.log2(Math.max(count, 1))),
    input = HYBRID_FSM ? 65536 + 256 * 2048 * 4 : 65536,
    stride = HYBRID_INPUT === "words" ? 4 : 2,
    output = HYBRID_INPUT === "jsstring" ? 65536 : input + cap * stride,
    pages = Math.ceil((output + 2 * cap + 16) / 65536);
  if (pages > memory.buffer.byteLength / 65536) {
    try {
      memory.grow(pages - memory.buffer.byteLength / 65536);
    } catch {
      return javascript(text);
    }
  }
  let units = count;
  if (HYBRID_INPUT === "utf8") {
    const result = encoder.encodeInto(
      text.slice(start),
      new Uint8Array(memory.buffer, input, 2 * cap),
    );
    if (result.read !== count || result.written > 2 * count)
      throw Error("Invalid payload character");
    units = result.written;
  } else if (HYBRID_INPUT === "words") {
    const view = new Int32Array(memory.buffer, input, count);
    for (let i = 0; i < count; i++) view[i] = table[text.charCodeAt(start + i)];
  } else if (HYBRID_INPUT !== "jsstring") {
    const view = new Uint16Array(memory.buffer, input, count);
    for (let i = 0; i < count; i++) view[i] = text.charCodeAt(start + i);
  }
  const status =
    HYBRID_INPUT === "jsstring"
      ? api.decode(text, start, count, output, length, mask)
      : api.decode(input, units, output, length, mask);
  if (status)
    throw Error(
      status === 1
        ? "Invalid payload character"
        : status === 2
          ? "Invalid payload length"
          : "Invalid payload padding",
    );
  return new Uint8Array(memory.buffer, output, length).slice();
}
