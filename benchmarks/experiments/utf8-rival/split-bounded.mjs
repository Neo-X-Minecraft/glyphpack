/* 0BSD, NeoX. ASCII output is independent of LUT reads; only validity uses
 * the ASCII table entry. Wide symbols use the full 15-bit value. */
import { prepare, finish, warmup } from "../../../src/utf8-raw/model.mjs";
export { warmup };
export function decode(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    end = text.length;
  let pos = start,
    at = 0,
    carry = 0,
    valid = -1,
    c = 0,
    entry = 0,
    data = 0;
  while (pos + 8 <= end && at + 15 <= length) {
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    if (c < 128) {
      carry = c & 127;
    } else {
      data = entry & 32767;
      out[at++] = (data >>> 7) ^ mask;
      carry = data & 127;
    }
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    if (c < 128) {
      out[at++] = ((carry << 1) | (c >>> 6)) ^ mask;
      carry = c & 63;
    } else {
      data = entry & 32767;
      out[at++] = ((carry << 1) | (data >>> 14)) ^ mask;
      out[at++] = (data >>> 6) ^ mask;
      carry = data & 63;
    }
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    if (c < 128) {
      out[at++] = ((carry << 2) | (c >>> 5)) ^ mask;
      carry = c & 31;
    } else {
      data = entry & 32767;
      out[at++] = ((carry << 2) | (data >>> 13)) ^ mask;
      out[at++] = (data >>> 5) ^ mask;
      carry = data & 31;
    }
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    if (c < 128) {
      out[at++] = ((carry << 3) | (c >>> 4)) ^ mask;
      carry = c & 15;
    } else {
      data = entry & 32767;
      out[at++] = ((carry << 3) | (data >>> 12)) ^ mask;
      out[at++] = (data >>> 4) ^ mask;
      carry = data & 15;
    }
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    if (c < 128) {
      out[at++] = ((carry << 4) | (c >>> 3)) ^ mask;
      carry = c & 7;
    } else {
      data = entry & 32767;
      out[at++] = ((carry << 4) | (data >>> 11)) ^ mask;
      out[at++] = (data >>> 3) ^ mask;
      carry = data & 7;
    }
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    if (c < 128) {
      out[at++] = ((carry << 5) | (c >>> 2)) ^ mask;
      carry = c & 3;
    } else {
      data = entry & 32767;
      out[at++] = ((carry << 5) | (data >>> 10)) ^ mask;
      out[at++] = (data >>> 2) ^ mask;
      carry = data & 3;
    }
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    if (c < 128) {
      out[at++] = ((carry << 6) | (c >>> 1)) ^ mask;
      carry = c & 1;
    } else {
      data = entry & 32767;
      out[at++] = ((carry << 6) | (data >>> 9)) ^ mask;
      out[at++] = (data >>> 1) ^ mask;
      carry = data & 1;
    }
    c = text.charCodeAt(pos++);
    entry = table[c];
    valid &= entry;
    if (c < 128) {
      out[at++] = ((carry << 7) | (c >>> 0)) ^ mask;
      carry = c & 0;
      data = c;
    } else {
      data = entry & 32767;
      out[at++] = ((carry << 7) | (data >>> 8)) ^ mask;
      out[at++] = (data >>> 0) ^ mask;
      carry = data & 0;
    }
  }
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
