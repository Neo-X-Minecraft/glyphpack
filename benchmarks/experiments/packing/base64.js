// 0BSD, NeoX. Native browser Base64 with the same SIMD verifier and fresh output.
import { api, checked } from "./verify.js";
export function binary(text, mode = 2) {
  let out;
  if (Uint8Array.fromBase64) out = Uint8Array.fromBase64(text);
  else {
    const str = atob(text);
    out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  }
  return checked(out, mode, mode);
}
export function memory() {
  return api.memory.buffer.byteLength;
}
