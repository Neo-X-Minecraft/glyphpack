/* 0BSD, NeoX. Fixed widths 7/15 share the same bit phase modulo 8. Every
 * eight symbols end byte-aligned, so all shifts in the bulk loop are constant.
 * This intentional unrolling is independent of payload length or CPU guessing. */
import { prepare, finish, warmup } from "./model.mjs";
export { warmup };
export function decode(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    end = text.length;
  const view = new DataView(out.buffer),
    xor = mask * 257;
  let pos = start,
    at = 0,
    carry = 0,
    valid = -1,
    c = 0,
    entry = 0,
    data = 0;
  // Eight symbols produce at most 15 bytes. Reserve that much before entering
  // the unrolled lap so valid padding never causes an out-of-bounds store.
  // Even ignored typed-array stores can poison V8 feedback on Chrome 109.
  while (pos + 8 <= end && at + 15 <= length) {
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    view.setUint16(at, (data << 1) ^ xor);
    at += +(c >= 128);
    carry = data & 127;

    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    view.setUint16(at, ((carry << 9) | (data >>> 6)) ^ xor);
    at += 1 + +(c >= 128);
    carry = data & 63;

    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    view.setUint16(at, ((carry << 10) | (data >>> 5)) ^ xor);
    at += 1 + +(c >= 128);
    carry = data & 31;

    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    view.setUint16(at, ((carry << 11) | (data >>> 4)) ^ xor);
    at += 1 + +(c >= 128);
    carry = data & 15;

    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    view.setUint16(at, ((carry << 12) | (data >>> 3)) ^ xor);
    at += 1 + +(c >= 128);
    carry = data & 7;

    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    view.setUint16(at, ((carry << 13) | (data >>> 2)) ^ xor);
    at += 1 + +(c >= 128);
    carry = data & 3;

    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    view.setUint16(at, ((carry << 14) | (data >>> 1)) ^ xor);
    at += 1 + +(c >= 128);
    carry = data & 1;

    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    view.setUint16(at, ((carry << 15) | (data >>> 0)) ^ xor);
    at += 1 + +(c >= 128);
  }
  // A full lap consumes 56 + 8*wide bits: always byte-aligned. The tail starts
  // at phase zero, but may contain more than eight symbols near the boundary.
  let step = 0;
  while (pos < end) {
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    data = entry & 32767;
    if (step) {
      if (at < length)
        out[at] = ((carry << step) | (data >>> (15 - step))) ^ mask;
      at++;
    }
    if (c >= 128) {
      if (at < length) out[at] = (data >>> (7 - step)) ^ mask;
      at++;
    }
    carry = data & ((1 << (7 - step)) - 1);
    step = (step + 1) & 7;
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
