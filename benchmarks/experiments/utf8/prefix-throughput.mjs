/* 0BSD, NeoX. High-aligned bit queue and speculative typed stores reduce
 * variable byte shifts. Uncommitted tail stores are overwritten or discarded;
 * coverage, all symbol checks and canonical padding remain mandatory. */
import { prepare } from "./prefix.mjs";
export function binary(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length);
  let q = 0,
    bits = 0,
    at = 0,
    last = 0,
    lastWord = 0,
    lastTotal = 0;
  for (let pos = start; pos < text.length; pos++) {
    const c = text.charCodeAt(pos),
      e = table[c];
    if (!e) throw Error("Invalid payload character");
    const w = c < 128 ? 7 : (e >>> 16) & 15,
      data = c < 128 ? c : e & 32767;
    q |= data << (32 - bits - w);
    lastWord = q;
    last = w;
    lastTotal = bits + w;
    out[at] = (q >>> 24) ^ mask;
    if (c >= 128) out[at + 1] = (q >>> 16) ^ mask;
    const advance = lastTotal >>> 3;
    at += advance;
    q <<= advance * 8;
    bits = lastTotal & 7;
  }
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if (
    (text.length > start && padding >= last) ||
    (lastWord >>> (32 - lastTotal)) & ((1 << padding) - 1)
  )
    throw Error("Invalid payload padding");
  return out;
}
