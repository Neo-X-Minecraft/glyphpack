/* 0BSD, NeoX. Fixed widths 7/15 share the same bit phase modulo 8. Every
 * eight symbols end byte-aligned, so all shifts in the bulk loop are constant.
 * This intentional unrolling is independent of payload length or CPU guessing. */
import { prepare, finish, warmup } from "./model.mjs";
export { warmup };
export function decode(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    view = new DataView(out.buffer),
    xor = mask * 0x01010101,
    end = text.length;
  let pos = start,
    at = 0,
    carry = 0,
    valid = -1,
    c = 0,
    entry = 0,
    data = 0;
  while (pos + 8 <= end) {
    const a = text.charCodeAt(pos),
      b = text.charCodeAt(pos + 1),
      d = text.charCodeAt(pos + 2),
      e = text.charCodeAt(pos + 3),
      f = text.charCodeAt(pos + 4),
      g = text.charCodeAt(pos + 5),
      h = text.charCodeAt(pos + 6),
      k = text.charCodeAt(pos + 7);
    if ((a | b | d | e | f | g | h | k) < 128 && at + 8 <= length) {
      valid &=
        table[a] &
        table[b] &
        table[d] &
        table[e] &
        table[f] &
        table[g] &
        table[h] &
        table[k];
      view.setUint32(
        at,
        ((a << 25) | (b << 18) | (d << 11) | (e << 4) | (f >>> 3)) ^ xor,
        false,
      );
      view.setUint32(
        at + 4,
        (((f & 7) << 29) | (g << 22) | (h << 15) | (k << 8)) ^ xor,
        false,
      );
      at += 7;
      pos += 8;
      c = k;
      data = k;
      continue;
    }

    c = a;
    pos++;
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    if (c >= 128) out[at++] = (data >>> 7) ^ mask;
    carry = data & 127;

    c = b;
    pos++;
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    out[at++] = ((carry << 1) | (data >>> 14)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 6) ^ mask;
    carry = data & 63;

    c = d;
    pos++;
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    out[at++] = ((carry << 2) | (data >>> 13)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 5) ^ mask;
    carry = data & 31;

    c = e;
    pos++;
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    out[at++] = ((carry << 3) | (data >>> 12)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 4) ^ mask;
    carry = data & 15;

    c = f;
    pos++;
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    out[at++] = ((carry << 4) | (data >>> 11)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 3) ^ mask;
    carry = data & 7;

    c = g;
    pos++;
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    out[at++] = ((carry << 5) | (data >>> 10)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 2) ^ mask;
    carry = data & 3;

    c = h;
    pos++;
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    out[at++] = ((carry << 6) | (data >>> 9)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 1) ^ mask;
    carry = data & 1;

    c = k;
    pos++;
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    out[at++] = ((carry << 7) | (data >>> 8)) ^ mask;
    if (c >= 128) out[at++] = data ^ mask;
  }
  let step = 0;
  while (pos < end) {
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    if (step) out[at++] = ((carry << step) | (data >>> (15 - step))) ^ mask;
    if (c >= 128) out[at++] = (data >>> (7 - step)) ^ mask;
    carry = data & ((1 << (7 - step)) - 1);
    step++;
  }
  finish(
    valid,
    at,
    -(end - start) & 7,
    length,
    data,
    c < 128 ? 7 : 15,
    end > start,
  );
  return out;
}
