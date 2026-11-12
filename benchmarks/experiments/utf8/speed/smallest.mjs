/* 0BSD, NeoX. Selected fast UTF-8 transport loop. Every symbol is checked;
 * header/length checks precede allocation and padding is checked after decoding.
 * No BigInt, Wasm, decompression API, network or Unicode property API is used. */
import { prepare, fail } from "./model-wide.mjs";
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
    if (!entry) fail(3);
    if (c < 128) {
      lastWidth = 7;
      // Seven bits emit no byte only when the previous queue was empty.
      // Otherwise exactly one byte is ready and its new shift is oldShift-1.
      if (bits === 0) {
        queue = c;
        bits = 7;
      } else {
        queue = (queue << 7) | c;
        bits--;
        out[at++] = (queue >>> bits) ^ mask;
      }
    } else {
      // Wide symbols contribute 14/15 bits, so the first byte is always ready.
      // With fewer than eight carried bits there can be at most two bytes.
      const width = entry >>> 16;
      queue = (queue << width) | (entry & 32767);
      bits += width - 8;
      lastWidth = width;
      out[at++] = (queue >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (queue >>> bits) ^ mask;
      }
    }
  }

  const padding = at * 8 + bits - length * 8;
  if (padding < 0) fail(2);
  // Zero padding belongs only to the final symbol. The first condition rejects
  // redundant symbols and also bounds padding below 15 before the JS shift.
  // Typed-array writes beyond the declared length were ignored; these low
  // bits still contain every such padding bit and must all be zero.
  if ((end > start && padding >= lastWidth) || queue & ((1 << padding) - 1))
    fail(4);
  return out;
}
