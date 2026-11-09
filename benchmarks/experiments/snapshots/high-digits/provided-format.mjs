var table = new Uint16Array(65536), radix = 0;
for (let c = 32; c < 65534; c++)
  c === 60 || c >= 127 && c <= 159 || c >= 55296 && c <= 57343 || c >= 64976 && c <= 65007 || c === 65279 || c === 8232 || c === 8233 || (table[c] = ++radix);
var threshold = radix * radix - 2147483649;
function invalidLength() {
  throw Error("Invalid payload length");
}
function invalidCharacter() {
  throw Error("Invalid payload character");
}
var radixBias = radix + 1;
const highTable = new Uint32Array(65536);
for (let cp = 0; cp < 65536; cp++) table[cp] && (highTable[cp] = radix * (table[cp] - 1) + 1);
function unpack(text, start, length, maskByte) {
  let fullEnd = length - 4, mask = maskByte * 16843009 | 0, bytes = new Uint8Array(length), view = new DataView(bytes.buffer), carry = 0, bits = 0, at = 0, word = 0, last = 0, textEnd = text.length, i = start;
  for (; i + 8 <= textEnd && at + 16 <= length; i += 8) {
    {
      let x = table[text.charCodeAt(i + 0)], y = highTable[text.charCodeAt(i + 1)];
      (!x || !y) && invalidCharacter();
      let value = x + y - 2;
      word = carry | value << bits;
      let output = word ^ mask;
      view.setUint32(at, output, !0);
      let narrow = (value & 2147483647) > threshold;
      bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
    }
    {
      let x = table[text.charCodeAt(i + 2)], y = highTable[text.charCodeAt(i + 3)];
      (!x || !y) && invalidCharacter();
      let value = x + y - 2;
      word = carry | value << bits;
      let output = word ^ mask;
      view.setUint32(at, output, !0);
      let narrow = (value & 2147483647) > threshold;
      bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
    }
    {
      let x = table[text.charCodeAt(i + 4)], y = highTable[text.charCodeAt(i + 5)];
      (!x || !y) && invalidCharacter();
      let value = x + y - 2;
      word = carry | value << bits;
      let output = word ^ mask;
      view.setUint32(at, output, !0);
      let narrow = (value & 2147483647) > threshold;
      bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
    }
    {
      let x = table[text.charCodeAt(i + 6)], y = highTable[text.charCodeAt(i + 7)];
      (!x || !y) && invalidCharacter();
      let value = x + y - 2;
      word = carry | value << bits;
      let output = word ^ mask;
      view.setUint32(at, output, !0);
      let narrow = (value & 2147483647) > threshold;
      bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
    }
  }
  for (; i < textEnd; i += 2) {
    let x = table[text.charCodeAt(i)], y = highTable[text.charCodeAt(i + 1)];
    (!x || !y) && invalidCharacter();
    let value = x + y - 2;
    word = carry | value << bits;
    let output = word ^ mask;
    at <= fullEnd ? view.setUint32(at, output, !0) : (bytes[at] = output, bytes[at + 1] = output >>> 8, bytes[at + 2] = output >>> 16, bytes[at + 3] = output >>> 24);
    let narrow = (value & 2147483647) > threshold;
    bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
  }
  at < length && invalidLength();
  {
    let remaining = length - at + last;
    if (textEnd > start && remaining <= 0 && invalidLength(), carry || remaining < 4 && word >>> 8 * remaining) throw Error("Invalid payload padding");
  }
  return bytes;
}
function binary(text) {
  text.length < 2 && invalidLength();
  let a = table[text.charCodeAt(0)], b = table[text.charCodeAt(1)];
  (!a || !b) && invalidCharacter();
  let first = a - 1, length, start = 2, mode = 0;
  if (mode = first & 1023, first < 32768) length = (first >>> 10) * radix + b - 1;
  else {
    if (first >= 33792) throw Error("Invalid payload header");
    text.length < 3 && invalidLength();
    let c = table[text.charCodeAt(2)];
    if (c || invalidCharacter(), start = 3, length = b - 1 + radix * (c - 1), length < 32 * radix) throw Error("Invalid payload header");
  }
  let kind = mode >>> 8, mask = mode & 255, digestLength = kind === 1 ? 4 : kind === 2 ? 32 : 0;
  (kind === 3 || (text.length - start) % 2) && invalidLength(), (!Number.isSafeInteger(length) || length < digestLength || length > (text.length - start) * 2) && invalidLength();
  let bytes = unpack(text, start, length, mask), end = length - digestLength;
  return digestLength ? bytes.subarray(0, end) : bytes;
}
export {
  binary
};
