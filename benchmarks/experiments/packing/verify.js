// 0BSD, NeoX. Every JS candidate uses the same production SIMD hash source.
import { loadWasm } from "../../../src/decoder/loader.js";
export const api = await loadWasm(WASM_B64);
export function checked(bytes, kind, mode) {
  const trailer = kind === 2 ? 32 : kind === 1 ? 4 : 0;
  if (bytes.length < trailer || (mode && mode !== kind))
    throw Error("Invalid integrity policy");
  if (mode) {
    const ptr = api.output_ptr(bytes.length);
    new Uint8Array(api.memory.buffer, ptr, bytes.length).set(bytes);
    if (api.check(bytes.length, kind, mode))
      throw Error("Experimental integrity mismatch");
  }
  return trailer ? bytes.subarray(0, bytes.length - trailer) : bytes;
}
