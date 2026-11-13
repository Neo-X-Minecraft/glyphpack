/* 0BSD, NeoX. Raw UTF-8 wire ~u2: the same forbidden ASCII as Base122, with
 * fixed 15-bit wide symbols. This is raw transport, without a digest or MAC. */
const digits =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const forbidden = [0, 10, 13, 34, 38, 92];
// Frozen gaps/lengths +32, half-open scalar ranges. Never derive from host Unicode.
const ranges =
  '\u00c0-!\u0272\u0090$!#"$!!$#!#!!!4!\u0100\'\u00c6!F"R"#N!!!"!"!);$&1*+!!N50!\u0085(!&""!$@"!!>=y+!.K)\'#"';
let table;
export function warmup() {
  if (table) return;
  table = new Int16Array(65536).fill(-1);
  // Valid entries contain 15 data bits, including zero. Invalid entries
  // are -1, whose sign bit survives the decoder's OR accumulation.
  // Duplicate ASCII in both bytes. Every entry's high seven bits are the
  // original 7-bit prefix; its low byte supplies the final carried bits.
  for (let c = 1; c < 128; c++)
    if (!forbidden.includes(c)) table[c] = (c << 8) | c;
  let ordinal = 0,
    end = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const begin = end + ranges.charCodeAt(i) - 32;
    end = begin + ranges.charCodeAt(i + 1) - 32;
    for (let c = begin; c < end && ordinal < 1536; c++, ordinal++)
      table[c] = (forbidden[ordinal >>> 8] << 8) | (ordinal & 255);
  }
}
export function prepare(text) {
  if (text.length < 6 || text.slice(0, 3) !== "~u2")
    throw Error("Invalid UTF-8 header");
  const a = digits.indexOf(text[3]),
    b = digits.indexOf(text[4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 5,
    length = 0,
    power = 1,
    digit;
  do {
    if (start >= text.length || power > 0x40000000)
      throw Error("Invalid payload length");
    digit = digits.indexOf(text[start++]);
    if (digit < 0) throw Error("Invalid UTF-8 header");
    length += (digit & 31) * power;
    power *= 32;
  } while (digit & 32);
  // Allocation safety is mandatory. At most 15 source bits can be carried by
  // one body symbol, so short headers cannot request disproportionately large
  // output buffers. The independent 1 GiB cap also bounds varint arithmetic.
  if (
    !Number.isSafeInteger(length) ||
    length > 0x40000000 ||
    length > Math.floor(((text.length - start) * 15) / 8)
  )
    throw Error("Invalid payload length");
  if (power > 32 && !(digit & 31)) throw Error("Invalid UTF-8 header");
  warmup();
  return { table, mask: a | (b << 6), length, start };
}
export function finish(valid, at, bits, length, last, width, body) {
  if (valid < 0) throw Error("Invalid payload character");
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  // Padding can occupy only the final symbol; zero-filled decoded bytes do
  // not excuse a missing body, extra complete symbol, or nonzero tail bits.
  if ((body && padding >= width) || last & ((1 << padding) - 1))
    throw Error("Invalid payload padding");
}
