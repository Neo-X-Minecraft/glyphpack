/* 0BSD, NeoX. Constant-width scalar candidate, same packet and validation. */
import { prepare, finish, warmup } from "./model.mjs";
export { warmup };
export function decode(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length);
  let q = 0,
    bits = 0,
    at = 0,
    valid = -1,
    last = 0,
    c = 0;
  for (let i = start; i < text.length; i++) {
    c = text.charCodeAt(i);
    const entry = table[c];
    valid &= entry;
    const wide = +(c >= 128),
      w = 7 + 8 * wide,
      data = c < 128 ? c : entry & 32767;
    q = (q << w) | data;
    bits += w;
    last = data;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (q >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (q >>> bits) ^ mask;
      }
    }
  }
  finish(valid, at, bits, length, last, c < 128 ? 7 : 15, text.length > start);
  return out;
}
