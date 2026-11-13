/* 0BSD, NeoX. Two-ASCII-symbol lookups and fixed-phase packing. */
import { prepare, finish, warmup as baseWarmup } from "./model.mjs";
let pairs;
function init(table) {
  pairs = new Int8Array(16384);
  for (let a = 0; a < 128; a++)
    if (table[a])
      for (let b = 0; b < 128; b++) if (table[b]) pairs[(a << 7) | b] = -1;
}
export function warmup() {
  baseWarmup();
  if (!pairs) init(prepare("~u2AAA").table);
}
export function decode(text) {
  const { table, mask, length, start } = prepare(text);
  if (!pairs) init(table);
  const out = new Uint8Array(length),
    end = text.length;
  let pos = start,
    at = 0,
    carry = 0,
    valid = -1,
    c = 0,
    entry = 0,
    data = 0;
  while (pos + 8 <= end && at + 15 <= length) {
    {
      const a = text.charCodeAt(pos++),
        b = text.charCodeAt(pos++);
      if ((a | b) < 128) {
        valid &= pairs[(a << 7) | b];
        out[at++] = ((a << 1) | (b >>> 6)) ^ mask;
        carry = b & 63;
        data = (b << 8) | b;
        c = b;
      } else {
        c = a;
        entry = table[c];
        valid &= entry;
        data = entry & 32767;
        if (c >= 128) out[at++] = (data >>> 7) ^ mask;
        carry = data & 127;
        c = b;
        entry = table[c];
        valid &= entry;
        data = entry & 32767;
        out[at++] = ((carry << 1) | (data >>> 14)) ^ mask;
        if (c >= 128) out[at++] = (data >>> 6) ^ mask;
        carry = data & 63;
      }
    }
    {
      const a = text.charCodeAt(pos++),
        b = text.charCodeAt(pos++);
      if ((a | b) < 128) {
        valid &= pairs[(a << 7) | b];
        out[at++] = ((carry << 2) | (a >>> 5)) ^ mask;
        out[at++] = ((a << 3) | (b >>> 4)) ^ mask;
        carry = b & 15;
        data = (b << 8) | b;
        c = b;
      } else {
        c = a;
        entry = table[c];
        valid &= entry;
        data = entry & 32767;
        out[at++] = ((carry << 2) | (data >>> 13)) ^ mask;
        if (c >= 128) out[at++] = (data >>> 5) ^ mask;
        carry = data & 31;
        c = b;
        entry = table[c];
        valid &= entry;
        data = entry & 32767;
        out[at++] = ((carry << 3) | (data >>> 12)) ^ mask;
        if (c >= 128) out[at++] = (data >>> 4) ^ mask;
        carry = data & 15;
      }
    }
    {
      const a = text.charCodeAt(pos++),
        b = text.charCodeAt(pos++);
      if ((a | b) < 128) {
        valid &= pairs[(a << 7) | b];
        out[at++] = ((carry << 4) | (a >>> 3)) ^ mask;
        out[at++] = ((a << 5) | (b >>> 2)) ^ mask;
        carry = b & 3;
        data = (b << 8) | b;
        c = b;
      } else {
        c = a;
        entry = table[c];
        valid &= entry;
        data = entry & 32767;
        out[at++] = ((carry << 4) | (data >>> 11)) ^ mask;
        if (c >= 128) out[at++] = (data >>> 3) ^ mask;
        carry = data & 7;
        c = b;
        entry = table[c];
        valid &= entry;
        data = entry & 32767;
        out[at++] = ((carry << 5) | (data >>> 10)) ^ mask;
        if (c >= 128) out[at++] = (data >>> 2) ^ mask;
        carry = data & 3;
      }
    }
    {
      const a = text.charCodeAt(pos++),
        b = text.charCodeAt(pos++);
      if ((a | b) < 128) {
        valid &= pairs[(a << 7) | b];
        out[at++] = ((carry << 6) | (a >>> 1)) ^ mask;
        out[at++] = ((a << 7) | (b >>> 0)) ^ mask;
        carry = b & 0;
        data = (b << 8) | b;
        c = b;
      } else {
        c = a;
        entry = table[c];
        valid &= entry;
        data = entry & 32767;
        out[at++] = ((carry << 6) | (data >>> 9)) ^ mask;
        if (c >= 128) out[at++] = (data >>> 1) ^ mask;
        carry = data & 1;
        c = b;
        entry = table[c];
        valid &= entry;
        data = entry & 32767;
        out[at++] = ((carry << 7) | (data >>> 8)) ^ mask;
        if (c >= 128) out[at++] = (data >>> 0) ^ mask;
        carry = data & 0;
      }
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
