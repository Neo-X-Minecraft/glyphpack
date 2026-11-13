// src/utf8-raw/model.mjs
var digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
var forbidden = [0, 10, 13, 34, 38, 92];
var ranges = `\xC0-!\u0272\x90$!#"$!!$#!#!!!4!\u0100'\xC6!F"R"#N!!!"!"!);$&1*+!!N50!\x85(!&""!$@"!!>=y+!.K)'#"`;
var table;
function warmup() {
  if (table) return;
  table = new Int16Array(2048).fill(-1);
  for (let c = 1; c < 128; c++)
    if (!forbidden.includes(c)) table[c] = c << 8 | c;
  let ordinal = 0, end = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const begin = end + ranges.charCodeAt(i) - 32;
    end = begin + ranges.charCodeAt(i + 1) - 32;
    for (let c = begin; c < end && ordinal < 1536; c++, ordinal++)
      table[c] = forbidden[ordinal >>> 8] << 8 | ordinal & 255;
  }
}
function prepare(text, offset = 0) {
  if (text.length - offset < 6 || text.slice(offset, offset + 3) !== "~u2")
    throw Error("Invalid UTF-8 header");
  const a = digits.indexOf(text[offset + 3]), b = digits.indexOf(text[offset + 4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = offset + 5, length = 0, power = 1, digit;
  do {
    if (start >= text.length || power > 1073741824)
      throw Error("Invalid payload length");
    digit = digits.indexOf(text[start++]);
    if (digit < 0) throw Error("Invalid UTF-8 header");
    length += (digit & 31) * power;
    power *= 32;
  } while (digit & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824 || length > Math.floor((text.length - start) * 15 / 8))
    throw Error("Invalid payload length");
  if (power > 32 && !(digit & 31)) throw Error("Invalid UTF-8 header");
  warmup();
  return { table, mask: a | b << 6, length, start };
}
function finish(valid, at, bits, length, last, width, body) {
  if (valid < 0) throw Error("Invalid payload character");
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if (body && padding >= width || last & (1 << padding) - 1)
    throw Error("Invalid payload padding");
}

// src/utf8-raw/unpack.mjs
function unpack(text, { table: table2, mask, length, start }, verifyFormat) {
  const check = false ? true : false ? verifyFormat : true;
  const out = new Uint8Array(length), end = text.length;
  let pos = start, at = 0, carry = 0, valid = 0, c = 0, entry = 0, data = 0;
  while (pos + 8 <= end && at + 15 <= length) {
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    if (c >= 128) out[at++] = data >>> 7 ^ mask;
    carry = data & 127;
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    out[at++] = (carry << 1 | data >>> 14) ^ mask;
    if (c >= 128) out[at++] = data >>> 6 ^ mask;
    carry = data & 63;
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    out[at++] = (carry << 2 | data >>> 13) ^ mask;
    if (c >= 128) out[at++] = data >>> 5 ^ mask;
    carry = data & 31;
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    out[at++] = (carry << 3 | data >>> 12) ^ mask;
    if (c >= 128) out[at++] = data >>> 4 ^ mask;
    carry = data & 15;
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    out[at++] = (carry << 4 | data >>> 11) ^ mask;
    if (c >= 128) out[at++] = data >>> 3 ^ mask;
    carry = data & 7;
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    out[at++] = (carry << 5 | data >>> 10) ^ mask;
    if (c >= 128) out[at++] = data >>> 2 ^ mask;
    carry = data & 3;
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    out[at++] = (carry << 6 | data >>> 9) ^ mask;
    if (c >= 128) out[at++] = data >>> 1 ^ mask;
    carry = data & 1;
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    out[at++] = (carry << 7 | data >>> 8) ^ mask;
    if (c >= 128) out[at++] = data ^ mask;
  }
  let step = 0;
  while (pos < end) {
    c = text.charCodeAt(pos++);
    entry = table2[c] ?? -1;
    if (check)
      valid |= entry;
    data = entry;
    if (step) {
      if (at < length)
        out[at] = (carry << step | data >>> 15 - step) ^ mask;
      at++;
    }
    if (c >= 128) {
      if (at < length) out[at] = data >>> 7 - step ^ mask;
      at++;
    }
    carry = data & (1 << 7 - step) - 1;
    step = step + 1 & 7;
  }
  if (check)
    finish(
      valid,
      at,
      -(end - start) & 7,
      length,
      data,
      c < 128 ? 7 : 15,
      end > start
    );
  else if (at * 8 + (-(end - start) & 7) < length * 8)
    throw Error("Invalid payload length");
  return out;
}

// src/utf8-raw/decoder.mjs
function decode(text) {
  return unpack(text, prepare(text), true);
}
export {
  decode,
  warmup
};
