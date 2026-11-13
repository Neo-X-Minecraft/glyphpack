/* 0BSD, NeoX. Exact enumerative UTF-8 by byte cost. BigInt tables are lazy;
 * a 4096-byte block bounds rank size independently of the whole payload. */
const counts = [126, 1920, 61406, 1048544],
  block = 4096,
  digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ways = [1n];
function ensure(n) {
  const goal = 1n << BigInt(n * 8);
  while (ways.at(-1) < goal) {
    let sum = 0n,
      r = ways.length;
    for (let w = 1; w <= 4 && w <= r; w++)
      sum += BigInt(counts[w - 1]) * ways[r - w];
    ways.push(sum);
  }
}
function lengthFor(n) {
  const goal = 1n << BigInt(n * 8);
  let low = 0,
    high = ways.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ways[mid] < goal) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function warmCompact() {
  ensure(block);
}
export function protect(text) {
  return text.replace(/<(?=\/?script|!--|\x01\x01\x01)/gi, "<\x01\x01\x01");
}
export function prepareCompact(text) {
  if (text.length < 6 || text.slice(0, 3) !== "~c1")
    throw Error("Invalid UTF-8 header");
  const a = digits.indexOf(text[3]),
    b = digits.indexOf(text[4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 5,
    length = 0,
    power = 1,
    d;
  do {
    if (start >= text.length || power > 0x40000000)
      throw Error("Invalid payload length");
    d = digits.indexOf(text[start++]);
    if (d < 0) throw Error("Invalid UTF-8 header");
    length += (d & 31) * power;
    power *= 32;
  } while (d & 32);
  if (
    !Number.isSafeInteger(length) ||
    length > 0x40000000 ||
    length > (text.length - start) * 4
  )
    throw Error("Invalid payload length");
  if (power > 32 && !(d & 31)) throw Error("Invalid UTF-8 header");
  return { start, length, mask: a | (b << 6) };
}
export function unpackCompact(text, { start, length, mask }, verifyFormat) {
  const check =
    typeof UTF8_FORMAT_RUNTIME === "undefined"
      ? true
      : UTF8_FORMAT_RUNTIME
        ? verifyFormat
        : UTF8_VERIFY_FORMAT;
  const encoded = text.slice(start),
    body = encoded.replace(/<\x01\x01\x01/g, "<");
  if (check && protect(body) !== encoded)
    throw Error("Invalid payload padding");
  const out = new Uint8Array(length);
  if (length) ensure(Math.min(length, block));
  let pos = 0;
  for (let at = 0; at < length; at += block) {
    const size = Math.min(block, length - at);
    let remaining = lengthFor(size),
      rank = 0n;
    while (remaining) {
      if (pos >= body.length) throw Error("Invalid payload length");
      const cp = body.codePointAt(pos);
      pos += cp > 65535 ? 2 : 1;
      let w, d;
      if (cp < 128) {
        w = 1;
        d = cp - 1 - (cp > 13 ? 1 : 0);
        if (cp === 0 || cp === 13) d = -1;
      } else if (cp < 2048) {
        w = 2;
        d = cp - 128;
      } else if (cp < 65536) {
        w = 3;
        d = cp - 2048 - (cp >= 57344 ? 2048 : 0) - (cp >= 65008 ? 32 : 0);
        if (
          (cp >= 55296 && cp < 57344) ||
          (cp >= 64976 && cp <= 65007) ||
          cp >= 65534
        )
          d = -1;
      } else {
        w = 4;
        d = ((cp >>> 16) - 1) * 65534 + (cp & 65535);
        if ((cp & 65535) >= 65534) d = -1;
      }
      if (check && (d < 0 || d >= counts[w - 1]))
        throw Error("Invalid payload character");
      if (w > remaining) throw Error("Invalid payload length");
      for (let j = 1; j < w; j++)
        rank += BigInt(counts[j - 1]) * ways[remaining - j];
      remaining -= w;
      rank += BigInt(d) * ways[remaining];
    }
    if (check && rank >= 1n << BigInt(size * 8))
      throw Error("Invalid payload padding");
    for (let i = size - 1; i >= 0; i--) {
      out[at + i] = Number(rank & 255n) ^ mask;
      rank >>= 8n;
    }
  }
  if (check && pos !== body.length) throw Error("Invalid payload padding");
  return out;
}
