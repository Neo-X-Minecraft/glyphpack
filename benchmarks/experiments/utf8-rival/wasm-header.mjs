/* 0BSD, NeoX. Shared header only; the body always runs in WebAssembly. */
const digits =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
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
  if (
    !Number.isSafeInteger(length) ||
    length > 0x40000000 ||
    length > Math.floor(((text.length - start) * 15) / 8)
  )
    throw Error("Invalid payload length");
  if (power > 32 && !(digit & 31)) throw Error("Invalid UTF-8 header");
  return { mask: a | (b << 6), length, start };
}
