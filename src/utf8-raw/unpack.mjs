/* 0BSD, NeoX. Fixed widths 7/15 share the same bit phase modulo 8. Every
 * eight symbols end byte-aligned, so all shifts in the bulk loop are constant.
 * This intentional unrolling is independent of payload length or CPU guessing. */
import { finish } from "./model.mjs";
export function unpack(text, { table, mask, length, start }, verifyFormat) {
  const check =
    typeof UTF8_FORMAT_RUNTIME === "undefined"
      ? true
      : UTF8_FORMAT_RUNTIME
        ? verifyFormat
        : UTF8_VERIFY_FORMAT;
  const out = new Uint8Array(length),
    end = text.length;
  let pos = start,
    at = 0,
    carry = 0,
    valid = 0,
    c = 0,
    entry = 0,
    data = 0;
  // Multi-policy builds always accumulate the cheap validity sign, then test
  // it once at the end only when requested. This avoids eight runtime policy
  // branches per lap. Fixed unchecked builds erase the accumulator entirely.
  // Eight symbols produce at most 15 bytes. Reserve that much before entering
  // the unrolled lap so valid padding never causes an out-of-bounds store.
  // Even ignored typed-array stores can change V8 feedback.
  while (pos + 8 <= end && at + 15 <= length) {
    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
    if (c >= 128) out[at++] = (data >>> 7) ^ mask;
    carry = data & 127;

    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
    out[at++] = ((carry << 1) | (data >>> 14)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 6) ^ mask;
    carry = data & 63;

    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
    out[at++] = ((carry << 2) | (data >>> 13)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 5) ^ mask;
    carry = data & 31;

    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
    out[at++] = ((carry << 3) | (data >>> 12)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 4) ^ mask;
    carry = data & 15;

    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
    out[at++] = ((carry << 4) | (data >>> 11)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 3) ^ mask;
    carry = data & 7;

    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
    out[at++] = ((carry << 5) | (data >>> 10)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 2) ^ mask;
    carry = data & 3;

    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
    out[at++] = ((carry << 6) | (data >>> 9)) ^ mask;
    if (c >= 128) out[at++] = (data >>> 1) ^ mask;
    carry = data & 1;

    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
    out[at++] = ((carry << 7) | (data >>> 8)) ^ mask;
    if (c >= 128) out[at++] = data ^ mask;
  }
  // A full lap consumes 56 + 8*wide bits: always byte-aligned. The tail starts
  // at phase zero, but may contain more than eight symbols near the boundary.
  let step = 0;
  while (pos < end) {
    c = text.charCodeAt(pos++);
    entry = table[c] ?? -1;
    if (
      typeof UTF8_FORMAT_RUNTIME === "undefined" ||
      UTF8_FORMAT_RUNTIME ||
      check
    )
      valid |= entry;
    data = entry;
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
  if (check)
    finish(
      valid,
      at,
      -(end - start) & 7,
      length,
      data,
      c < 128 ? 7 : 15,
      end > start,
    );
  else if (at * 8 + (-(end - start) & 7) < length * 8)
    throw Error("Invalid payload length");
  return out;
}
