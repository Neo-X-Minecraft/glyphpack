/* 0BSD, NeoX. One Wasm kernel, native UTF-8 conversion or copied UTF-16,
 * reusable geometric arenas, and an exact owned output copy. No JS fallback. */
import { prepare } from "./wasm-header.mjs";
const memory = new WebAssembly.Memory({ initial: 2 });
const bytes = Uint8Array.from(atob(WASM_BYTES), (c) => c.charCodeAt(0));
const api = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
  env: { memory },
}).exports;
const encoder = WASM_UTF16 ? null : new TextEncoder();
let initialized = false,
  capacity = 0,
  output = 0;
export function warmup() {
  if (!initialized) {
    api.init();
    initialized = true;
  }
}
export function decode(text) {
  const { mask, length, start } = prepare(text),
    count = text.length - start;
  warmup();
  if (count > capacity) {
    capacity = 2 ** Math.ceil(Math.log2(Math.max(count, 1)));
    output = 65536 + 2 * capacity;
  }
  if (!output) output = 65536;
  const pages = Math.ceil((output + length + 16) / 65536);
  if (pages > memory.buffer.byteLength / 65536)
    memory.grow(pages - memory.buffer.byteLength / 65536);
  let units = count;
  if (WASM_UTF16) {
    const view = new Uint16Array(memory.buffer, 65536, count);
    if (WASM_TOKENS) {
      const table = new Uint16Array(memory.buffer, api.table_ptr(), 2048);
      for (let i = 0; i < count; i++)
        view[i] = table[text.charCodeAt(start + i)];
    } else {
      if (WASM_COPY === 1) {
        let i = 0;
        for (; i + 8 <= count; i += 8) {
          view[i] = text.charCodeAt(start + i);
          view[i + 1] = text.charCodeAt(start + i + 1);
          view[i + 2] = text.charCodeAt(start + i + 2);
          view[i + 3] = text.charCodeAt(start + i + 3);
          view[i + 4] = text.charCodeAt(start + i + 4);
          view[i + 5] = text.charCodeAt(start + i + 5);
          view[i + 6] = text.charCodeAt(start + i + 6);
          view[i + 7] = text.charCodeAt(start + i + 7);
        }
        for (; i < count; i++) view[i] = text.charCodeAt(start + i);
      } else if (WASM_COPY === 2) {
        const words = new Uint32Array(memory.buffer, 65536, count >>> 1);
        let i = 0;
        for (; i + 1 < count; i += 2)
          words[i >>> 1] =
            text.charCodeAt(start + i) | (text.charCodeAt(start + i + 1) << 16);
        if (i < count) view[i] = text.charCodeAt(start + i);
      } else
        for (let i = 0; i < count; i++) view[i] = text.charCodeAt(start + i);
    }
  } else {
    const result = encoder.encodeInto(
      text.slice(start),
      new Uint8Array(memory.buffer, 65536, 2 * capacity),
    );
    if (result.read !== count) throw Error("Invalid payload character");
    units = result.written;
  }
  const status = api.decode(65536, units, output, length, mask);
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
