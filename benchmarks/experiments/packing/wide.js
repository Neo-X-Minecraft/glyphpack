// 0BSD, NeoX. Dedicated widened-BMP core: no other alphabet branches in the loop.
import { api, checked } from "./verify.js";
const R = 63484,
  T = R * R - 2147483649,
  table = new Uint16Array(65536);
let digit = 0;
for (let c = 0; c < 65536; c++)
  if (c !== 0 && c !== 13 && c !== 92 && c !== 96 && (c < 55296 || c > 57343))
    table[c] = ++digit;
export function binary(text, mode = 2) {
  const value = (i) => {
    const v = table[text.charCodeAt(i)];
    if (!v) throw Error("Invalid glyph");
    return v - 1;
  };
  const first = value(0),
    second = value(1),
    settings = first & 1023,
    kind = settings >>> 8,
    mask = settings & 255;
  let start = 2,
    size = (first >>> 10) * R + second;
  if (first >= 32768) {
    if (first >= 33792) throw Error("Invalid header");
    start = 3;
    size = second + R * value(2);
  }
  const trailer = kind === 2 ? 32 : kind === 1 ? 4 : 0;
  if (
    kind === 3 ||
    size < trailer ||
    size > (text.length - start) * 2 ||
    (text.length - start) % 2 ||
    (mode && mode !== kind)
  )
    throw Error("Invalid size");
  const out = new Uint8Array(size),
    view = new DataView(out.buffer),
    xor = (mask * 0x01010101) | 0;
  let carry = 0,
    shift = 0,
    at = 0,
    last = 0,
    advance = 0;
  for (let pos = start; pos < text.length; pos += 2) {
    const packed = value(pos) + R * value(pos + 1);
    last = carry | (packed << shift);
    const word = last ^ xor;
    if (at + 4 <= size) view.setUint32(at, word, true);
    else {
      out[at] = word;
      out[at + 1] = word >>> 8;
      out[at + 2] = word >>> 16;
      out[at + 3] = word >>> 24;
    }
    const narrow = (packed & 2147483647) > T;
    if (shift === 0 && narrow) {
      carry = last >>> 24;
      shift = 7;
      advance = 3;
    } else {
      carry = shift ? packed >>> (32 - shift) : 0;
      shift -= +narrow;
      advance = 4;
    }
    at += advance;
  }
  const remain = size - at + advance;
  if (
    at < size ||
    (text.length > start && remain <= 0) ||
    carry ||
    (remain < 4 && last >>> (8 * remain))
  )
    throw Error("Invalid padding");
  return checked(out, kind, mode);
}
export function memory() {
  return api.memory.buffer.byteLength;
}
