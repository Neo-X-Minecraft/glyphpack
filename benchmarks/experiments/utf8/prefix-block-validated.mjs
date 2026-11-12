/* 0BSD, NeoX. ASCII block candidate with combined symbol validation. The
 * measured scalar split loop is faster; this file remains benchmark-only. */
import { prepare } from "./prefix.mjs";
export function binary(text) {
  const { table, reject, mask, length, start } = prepare(text);

  const out = new Uint8Array(length);
  let queue = 0,
    bits = 0,
    at = 0,
    pos = start,
    lastWidth = 0,
    padding = 0;
  while (pos < text.length) {
    if (bits === 0 && pos + 8 <= text.length && at + 7 <= length) {
      const a = text.charCodeAt(pos),
        b = text.charCodeAt(pos + 1),
        c = text.charCodeAt(pos + 2),
        d = text.charCodeAt(pos + 3),
        e = text.charCodeAt(pos + 4),
        f = text.charCodeAt(pos + 5),
        g = text.charCodeAt(pos + 6),
        h = text.charCodeAt(pos + 7);
      if ((a | b | c | d | e | f | g | h) < 128) {
        if (
          !(
            table[a] &
            table[b] &
            table[c] &
            table[d] &
            table[e] &
            table[f] &
            table[g] &
            table[h] &
            65536
          )
        )
          throw Error("Invalid payload character");
        out[at] = ((a << 1) | (b >>> 6)) ^ mask;
        out[at + 1] = ((b << 2) | (c >>> 5)) ^ mask;
        out[at + 2] = ((c << 3) | (d >>> 4)) ^ mask;
        out[at + 3] = ((d << 4) | (e >>> 3)) ^ mask;
        out[at + 4] = ((e << 5) | (f >>> 2)) ^ mask;
        out[at + 5] = ((f << 6) | (g >>> 1)) ^ mask;
        out[at + 6] = ((g << 7) | h) ^ mask;
        at += 7;
        pos += 8;
        queue = 0;
        lastWidth = 7;
        continue;
      }
    }
    const c = text.charCodeAt(pos++);
    if (c < 128) {
      if (!table[c]) throw Error("Invalid payload character");
      queue = (queue << 7) | c;
      bits += 7;
      lastWidth = 7;
    } else {
      const entry = table[c];
      if (!entry) throw Error("Invalid payload character");
      const width = entry >>> 16;
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
  const extra = at * 8 + bits - length * 8;
  if (extra < 0) throw Error("Invalid payload length");
  if ((pos > start && extra >= lastWidth) || queue & ((1 << extra) - 1))
    throw Error("Invalid payload padding");
  return out;
}
