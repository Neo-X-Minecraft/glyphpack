/* 0BSD, NeoX. Full validation with one table read per character. Padding is
 * checked once after the loop; typed-array tail stores outside output are ignored. */
import { prepare } from "./prefix.mjs";
export function binary(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    end = text.length;
  let queue = 0,
    bits = 0,
    at = 0,
    lastWidth = 0;
  for (let pos = start; pos < end; pos++) {
    const c = text.charCodeAt(pos),
      entry = table[c];
    if (!entry) throw Error("Invalid payload character");
    if (c < 128) {
      queue = (queue << 7) | c;
      bits += 7;
      lastWidth = 7;
    } else {
      const width = (entry >>> 16) & 15;
      queue = (queue << width) | (entry & 32767);
      bits += width;
      lastWidth = width;
    }
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (queue >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (queue >>> bits) ^ mask;
      }
    }
  }
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if ((end > start && padding >= lastWidth) || queue & ((1 << padding) - 1))
    throw Error("Invalid payload padding");
  return out;
}
