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
function xxhash32(data, end = data.length) {
  let v = new DataView(data.buffer, data.byteOffset, end), i = 0, h;
  if (end >= 16) {
    let a = 606290984, b = -2048144777, c = 0, d = 1640531535;
    for (; i + 16 <= end; i += 16)
      a = a + Math.imul(v.getUint32(i, !0), 2246822519) | 0, a = Math.imul(a << 13 | a >>> 19, 2654435761), b = b + Math.imul(v.getUint32(i + 4, !0), 2246822519) | 0, b = Math.imul(b << 13 | b >>> 19, 2654435761), c = c + Math.imul(v.getUint32(i + 8, !0), 2246822519) | 0, c = Math.imul(c << 13 | c >>> 19, 2654435761), d = d + Math.imul(v.getUint32(i + 12, !0), 2246822519) | 0, d = Math.imul(d << 13 | d >>> 19, 2654435761);
    h = (a << 1 | a >>> 31) + (b << 7 | b >>> 25) + (c << 12 | c >>> 20) + (d << 18 | d >>> 14);
  } else h = 374761393;
  for (h = h + end | 0; i + 4 <= end; i += 4)
    h = h + Math.imul(v.getUint32(i, !0), 3266489917) | 0, h = Math.imul(h << 17 | h >>> 15, 668265263);
  for (; i < end; i++)
    h = h + Math.imul(data[i], 374761393) | 0, h = Math.imul(h << 11 | h >>> 21, 2654435761);
  return h ^= h >>> 15, h = Math.imul(h, 2246822519), h ^= h >>> 13, h = Math.imul(h, 3266489917), h ^= h >>> 16, h >>> 0;
}
function createBlake3() {
  function compress(cv2, m, offset, lo, hi, length, flags) {
    let s0 = cv2[0] | 0, s1 = cv2[1] | 0, s2 = cv2[2] | 0, s3 = cv2[3] | 0, s4 = cv2[4] | 0, s5 = cv2[5] | 0, s6 = cv2[6] | 0, s7 = cv2[7] | 0, s8 = 1779033703, s9 = -1150833019, s10 = 1013904242, s11 = -1521486534, s12 = lo | 0, s13 = hi | 0, s14 = length, s15 = flags, m0 = m[offset + 0] | 0, m1 = m[offset + 1] | 0, m2 = m[offset + 2] | 0, m3 = m[offset + 3] | 0, m4 = m[offset + 4] | 0, m5 = m[offset + 5] | 0, m6 = m[offset + 6] | 0, m7 = m[offset + 7] | 0, m8 = m[offset + 8] | 0, m9 = m[offset + 9] | 0, m10 = m[offset + 10] | 0, m11 = m[offset + 11] | 0, m12 = m[offset + 12] | 0, m13 = m[offset + 13] | 0, m14 = m[offset + 14] | 0, m15 = m[offset + 15] | 0;
    for (let round = 0; round < 7; round++) {
      s0 = s0 + s4 + m0 | 0, s12 ^= s0, s12 = s12 >>> 16 | s12 << 16, s8 = s8 + s12 | 0, s4 ^= s8, s4 = s4 >>> 12 | s4 << 20, s0 = s0 + s4 + m1 | 0, s12 ^= s0, s12 = s12 >>> 8 | s12 << 24, s8 = s8 + s12 | 0, s4 ^= s8, s4 = s4 >>> 7 | s4 << 25, s1 = s1 + s5 + m2 | 0, s13 ^= s1, s13 = s13 >>> 16 | s13 << 16, s9 = s9 + s13 | 0, s5 ^= s9, s5 = s5 >>> 12 | s5 << 20, s1 = s1 + s5 + m3 | 0, s13 ^= s1, s13 = s13 >>> 8 | s13 << 24, s9 = s9 + s13 | 0, s5 ^= s9, s5 = s5 >>> 7 | s5 << 25, s2 = s2 + s6 + m4 | 0, s14 ^= s2, s14 = s14 >>> 16 | s14 << 16, s10 = s10 + s14 | 0, s6 ^= s10, s6 = s6 >>> 12 | s6 << 20, s2 = s2 + s6 + m5 | 0, s14 ^= s2, s14 = s14 >>> 8 | s14 << 24, s10 = s10 + s14 | 0, s6 ^= s10, s6 = s6 >>> 7 | s6 << 25, s3 = s3 + s7 + m6 | 0, s15 ^= s3, s15 = s15 >>> 16 | s15 << 16, s11 = s11 + s15 | 0, s7 ^= s11, s7 = s7 >>> 12 | s7 << 20, s3 = s3 + s7 + m7 | 0, s15 ^= s3, s15 = s15 >>> 8 | s15 << 24, s11 = s11 + s15 | 0, s7 ^= s11, s7 = s7 >>> 7 | s7 << 25, s0 = s0 + s5 + m8 | 0, s15 ^= s0, s15 = s15 >>> 16 | s15 << 16, s10 = s10 + s15 | 0, s5 ^= s10, s5 = s5 >>> 12 | s5 << 20, s0 = s0 + s5 + m9 | 0, s15 ^= s0, s15 = s15 >>> 8 | s15 << 24, s10 = s10 + s15 | 0, s5 ^= s10, s5 = s5 >>> 7 | s5 << 25, s1 = s1 + s6 + m10 | 0, s12 ^= s1, s12 = s12 >>> 16 | s12 << 16, s11 = s11 + s12 | 0, s6 ^= s11, s6 = s6 >>> 12 | s6 << 20, s1 = s1 + s6 + m11 | 0, s12 ^= s1, s12 = s12 >>> 8 | s12 << 24, s11 = s11 + s12 | 0, s6 ^= s11, s6 = s6 >>> 7 | s6 << 25, s2 = s2 + s7 + m12 | 0, s13 ^= s2, s13 = s13 >>> 16 | s13 << 16, s8 = s8 + s13 | 0, s7 ^= s8, s7 = s7 >>> 12 | s7 << 20, s2 = s2 + s7 + m13 | 0, s13 ^= s2, s13 = s13 >>> 8 | s13 << 24, s8 = s8 + s13 | 0, s7 ^= s8, s7 = s7 >>> 7 | s7 << 25, s3 = s3 + s4 + m14 | 0, s14 ^= s3, s14 = s14 >>> 16 | s14 << 16, s9 = s9 + s14 | 0, s4 ^= s9, s4 = s4 >>> 12 | s4 << 20, s3 = s3 + s4 + m15 | 0, s14 ^= s3, s14 = s14 >>> 8 | s14 << 24, s9 = s9 + s14 | 0, s4 ^= s9, s4 = s4 >>> 7 | s4 << 25;
      let t = m0;
      m0 = m2, m2 = m3, m3 = m10, m10 = m12, m12 = m9, m9 = m11, m11 = m5, m5 = t, t = m1, m1 = m6, m6 = m4, m4 = m7, m7 = m13, m13 = m14, m14 = m15, m15 = m8, m8 = t;
    }
    cv2[0] = s0 ^ s8, cv2[1] = s1 ^ s9, cv2[2] = s2 ^ s10, cv2[3] = s3 ^ s11, cv2[4] = s4 ^ s12, cv2[5] = s5 ^ s13, cv2[6] = s6 ^ s14, cv2[7] = s7 ^ s15;
  }
  let iv = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]), little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1, cv = new Uint32Array(8), block = new Uint32Array(16), stack = new Uint32Array(432);
  return function(data, end = data.length) {
    let input = new DataView(data.buffer, data.byteOffset, end), words = little && !(data.byteOffset & 3) ? new Uint32Array(data.buffer, data.byteOffset, Math.floor(end / 4)) : null, chunks = Math.max(1, Math.ceil(end / 1024)), leafRoot = chunks === 1 ? 8 : 0, top = 0;
    for (let chunk = 0; chunk < chunks; chunk++) {
      cv.set(iv);
      let lo = chunk >>> 0, hi = Math.floor(chunk / 4294967296), begin = chunk * 1024, limit = Math.min(begin + 1024, end), blocks = Math.max(1, Math.ceil((limit - begin) / 64));
      for (let b = 0; b < blocks; b++) {
        let pos = begin + b * 64, len = Math.min(64, limit - pos), source = words, offset = pos / 4;
        if (!words || len < 64) {
          block.fill(0);
          let j = 0;
          for (; j + 4 <= len; j += 4) block[j >>> 2] = input.getUint32(pos + j, !0);
          for (; j < len; j++) block[j >>> 2] |= data[pos + j] << (j & 3) * 8;
          source = block, offset = 0;
        }
        let flags = (b === 0 ? 1 : 0) | (b === blocks - 1 ? 2 | leafRoot : 0);
        compress(cv, source, offset, lo, hi, len, flags);
      }
      if (chunk === chunks - 1)
        for (; top; ) {
          top -= 8;
          for (let i = 0; i < 8; i++)
            block[i] = stack[top + i], block[i + 8] = cv[i];
          cv.set(iv), compress(cv, block, 0, 0, 0, 64, 4 | (top === 0 ? 8 : 0));
        }
      else {
        let count = chunk + 1;
        for (; count % 2 === 0; ) {
          top -= 8;
          for (let i = 0; i < 8; i++)
            block[i] = stack[top + i], block[i + 8] = cv[i];
          cv.set(iv), compress(cv, block, 0, 0, 0, 64, 4), count /= 2;
        }
        stack.set(cv, top), top += 8;
      }
    }
    let result = new Uint8Array(32), out = new DataView(result.buffer);
    for (let i = 0; i < 8; i++) out.setUint32(i * 4, cv[i], !0);
    return result;
  };
}
function checkDigestBounds(bytes, end, digestLength) {
  (!Number.isSafeInteger(end) || end < 0 || end + digestLength !== bytes.length) && invalidLength();
}
var secureHash;
function checkSelectedIntegrityMode(kind, length, selected) {
  if (kind !== selected || length < (selected === 1 ? 4 : 32)) throw Error("Required payload integrity mode missing");
}
function verifySelectedData(bytes, end, selected) {
  if (checkDigestBounds(bytes, end, selected === 1 ? 4 : 32), selected === 1) {
    let stored = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(end, !0);
    if (xxhash32(bytes, end) !== stored) throw Error("Payload checksum mismatch");
  } else {
    let digest = (secureHash || (secureHash = createBlake3()))(bytes, end), difference = 0;
    for (let i = 0; i < 32; i++) difference |= digest[i] ^ bytes[end + i];
    if (difference) throw Error("Payload digest mismatch");
  }
}
function selectFormat(value = !0) {
  if (value !== !0 && value !== !1) throw Error("Unsupported format verification option");
  return value;
}
function selectData(value = "secure") {
  if (value === "secure" || value === !0) return 2;
  if (value === "fast") return 1;
  if (value === "none" || value === !1) return 0;
  throw Error("Unsupported data verification mode");
}
var radixBias = radix + 1;
const highTable = new Uint32Array(65536);
for (let cp = 0; cp < 65536; cp++) table[cp] && (highTable[cp] = radix * (table[cp] - 1) + 1);
function unpack(text, start, length, maskByte, verifyFormat, dataKind) {
  let fullEnd = length - 4, mask = maskByte * 16843009 | 0, bytes = new Uint8Array(length), view = new DataView(bytes.buffer), carry = 0, bits = 0, at = 0, word = 0, last = 0, textEnd = text.length, i = start;
  for (; i + 8 <= textEnd && at + 16 <= length; i += 8) {
    {
      let x = table[text.charCodeAt(i + 0)], y = highTable[text.charCodeAt(i + 1)];
      verifyFormat && (!x || !y) && invalidCharacter();
      let value = x + y - 2 - (y ? 0 : radix - 1);
      word = carry | value << bits;
      let output = word ^ mask;
      view.setUint32(at, output, !0);
      let narrow = (value & 2147483647) > threshold;
      bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
    }
    {
      let x = table[text.charCodeAt(i + 2)], y = highTable[text.charCodeAt(i + 3)];
      verifyFormat && (!x || !y) && invalidCharacter();
      let value = x + y - 2 - (y ? 0 : radix - 1);
      word = carry | value << bits;
      let output = word ^ mask;
      view.setUint32(at, output, !0);
      let narrow = (value & 2147483647) > threshold;
      bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
    }
    {
      let x = table[text.charCodeAt(i + 4)], y = highTable[text.charCodeAt(i + 5)];
      verifyFormat && (!x || !y) && invalidCharacter();
      let value = x + y - 2 - (y ? 0 : radix - 1);
      word = carry | value << bits;
      let output = word ^ mask;
      view.setUint32(at, output, !0);
      let narrow = (value & 2147483647) > threshold;
      bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
    }
    {
      let x = table[text.charCodeAt(i + 6)], y = highTable[text.charCodeAt(i + 7)];
      verifyFormat && (!x || !y) && invalidCharacter();
      let value = x + y - 2 - (y ? 0 : radix - 1);
      word = carry | value << bits;
      let output = word ^ mask;
      view.setUint32(at, output, !0);
      let narrow = (value & 2147483647) > threshold;
      bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
    }
  }
  for (; i < textEnd; i += 2) {
    let x = table[text.charCodeAt(i)], y = highTable[text.charCodeAt(i + 1)];
    verifyFormat && (!x || !y) && invalidCharacter();
    let value = x + y - 2 - (y ? 0 : radix - 1);
    word = carry | value << bits;
    let output = word ^ mask;
    at <= fullEnd ? view.setUint32(at, output, !0) : (bytes[at] = output, bytes[at + 1] = output >>> 8, bytes[at + 2] = output >>> 16, bytes[at + 3] = output >>> 24);
    let narrow = (value & 2147483647) > threshold;
    bits === 0 ? narrow ? (carry = word >>> 24, bits = 7, at += 3, last = 3) : (carry = 0, at += 4, last = 4) : (carry = value >>> 32 - bits, bits -= narrow, at += 4, last = 4);
  }
  if ((verifyFormat || dataKind !== 0) && at < length && invalidLength(), verifyFormat) {
    let remaining = length - at + last;
    if (textEnd > start && remaining <= 0 && invalidLength(), carry || remaining < 4 && word >>> 8 * remaining) throw Error("Invalid payload padding");
  }
  return bytes;
}
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData);
  verifyFormat && text.length < 2 && invalidLength();
  let a = table[text.charCodeAt(0)], b = table[text.charCodeAt(1)];
  verifyFormat && (!a || !b) && invalidCharacter();
  let first = a - 1, length, start = 2, mode = 0;
  if (mode = first & 1023, first < 32768) length = (first >>> 10) * radix + b - 1;
  else {
    if (verifyFormat) {
      if (first >= 33792) throw Error("Invalid payload header");
      text.length < 3 && invalidLength();
    }
    let c = table[text.charCodeAt(2)];
    if (verifyFormat && !c && invalidCharacter(), start = 3, length = b - 1 + radix * (c - 1), verifyFormat && length < 32 * radix) throw Error("Invalid payload header");
  }
  let kind = mode >>> 8, mask = mode & 255, digestLength = kind === 1 ? 4 : kind === 2 ? 32 : 0;
  verifyFormat && (kind === 3 || (text.length - start) % 2) && invalidLength(), (!Number.isSafeInteger(length) || length < digestLength || length > (text.length - start) * 2) && invalidLength(), dataKind !== 0 && checkSelectedIntegrityMode(kind, length, dataKind);
  let bytes = unpack(text, start, length, mask, verifyFormat, dataKind), end = length - digestLength;
  return dataKind !== 0 && verifySelectedData(bytes, end, dataKind), digestLength ? bytes.subarray(0, end) : bytes;
}
export {
  binary
};
