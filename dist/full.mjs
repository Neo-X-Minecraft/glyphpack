// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function failure(status) {
  return status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
    status === 2 ? "Invalid payload length" : status === 9 ? "Unsupported payload codec" : status === 10 ? "Unsupported memory optimization option" : status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 6 ? "Payload checksum mismatch" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure"
  );
}
function warmWasm(api2, codecs, heavy) {
  let status = api2.warmup(codecs, heavy);
  if (status) throw failure(status);
}
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  let length = text.length;
  if (length < 2) throw failure(2);
  let first = text.charCodeAt(0);
  if (!(first === 9 || first === 10 || first === 12)) throw failure(9);
  let pointer = api2.input_ptr(length);
  if (pointer === 0 && length) throw failure(8);
  if (littleEndian) {
    let input = new Uint16Array(api2.memory.buffer, pointer, length);
    for (let i = 0; i < length; i++) input[i] = text.charCodeAt(i);
  } else {
    let input = new DataView(api2.memory.buffer, pointer, length * 2);
    for (let i = 0; i < length; i++)
      input.setUint16(i * 2, text.charCodeAt(i), !0);
  }
  let status = api2.decode(+verifyFormat, dataKind, +memoryHeavy);
  if (status) throw failure(status);
  let stored = api2.stored_len(), end = api2.payload_len(), bytes = new Uint8Array(stored);
  return bytes.set(new Uint8Array(api2.memory.buffer, api2.output_ptr(), stored)), end === stored ? bytes : bytes.subarray(0, end);
}

// loader.js
async function loadWasm(payload) {
  if (typeof WebAssembly > "u") throw Error("WebAssembly is required");
  if (typeof DecompressionStream > "u") throw Error("DecompressionStream is required");
  let compressed;
  if (Uint8Array.fromBase64) compressed = Uint8Array.fromBase64(payload);
  else {
    let text = atob(payload);
    compressed = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) compressed[i] = text.charCodeAt(i);
  }
  let bytes = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return (await WebAssembly.instantiate(bytes)).instance.exports;
}

// utf8-model.mjs
var digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", forbidden = [0, 10, 13, 34, 38, 92], ranges = `\xC0-!\u0272\x90$!#"$!!$#!#!!!4!\u0100'\xC6!F"R"#N!!!"!"!);$&1*+!!N50!\x85(!&""!$@"!!>=y+!.K)'#"`, table;
function warmup() {
  if (table) return;
  table = new Int16Array(2048).fill(-1);
  for (let c = 1; c < 128; c++)
    forbidden.includes(c) || (table[c] = c << 8 | c);
  let ordinal = 0, end = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    let begin = end + ranges.charCodeAt(i) - 32;
    end = begin + ranges.charCodeAt(i + 1) - 32;
    for (let c = begin; c < end && ordinal < 1536; c++, ordinal++)
      table[c] = forbidden[ordinal >>> 8] << 8 | ordinal & 255;
  }
}
function prepare(text, offset = 0) {
  if (text.length - offset < 6 || text.slice(offset, offset + 3) !== "~u2")
    throw Error("Invalid UTF-8 header");
  let a = digits.indexOf(text[offset + 3]), b = digits.indexOf(text[offset + 4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = offset + 5, length = 0, power = 1, digit;
  do {
    if (start >= text.length || power > 1073741824)
      throw Error("Invalid payload length");
    if (digit = digits.indexOf(text[start++]), digit < 0) throw Error("Invalid UTF-8 header");
    length += (digit & 31) * power, power *= 32;
  } while (digit & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824 || length > Math.floor((text.length - start) * 15 / 8))
    throw Error("Invalid payload length");
  if (power > 32 && !(digit & 31)) throw Error("Invalid UTF-8 header");
  return warmup(), { table, mask: a | b << 6, length, start };
}
function finish(valid, at, bits, length, last, width, body) {
  if (valid < 0) throw Error("Invalid payload character");
  let padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if (body && padding >= width || last & (1 << padding) - 1)
    throw Error("Invalid payload padding");
}

// utf8-unpack.mjs
function unpack(text, { table: table2, mask, length, start }, verifyFormat) {
  let check = verifyFormat, out = new Uint8Array(length), end = text.length, pos = start, at = 0, carry = 0, valid = 0, c = 0, entry = 0, data = 0;
  for (; pos + 8 <= end && at + 15 <= length; )
    c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, c >= 128 && (out[at++] = data >>> 7 ^ mask), carry = data & 127, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 1 | data >>> 14) ^ mask, c >= 128 && (out[at++] = data >>> 6 ^ mask), carry = data & 63, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 2 | data >>> 13) ^ mask, c >= 128 && (out[at++] = data >>> 5 ^ mask), carry = data & 31, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 3 | data >>> 12) ^ mask, c >= 128 && (out[at++] = data >>> 4 ^ mask), carry = data & 15, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 4 | data >>> 11) ^ mask, c >= 128 && (out[at++] = data >>> 3 ^ mask), carry = data & 7, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 5 | data >>> 10) ^ mask, c >= 128 && (out[at++] = data >>> 2 ^ mask), carry = data & 3, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 6 | data >>> 9) ^ mask, c >= 128 && (out[at++] = data >>> 1 ^ mask), carry = data & 1, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 7 | data >>> 8) ^ mask, c >= 128 && (out[at++] = data ^ mask);
  let step = 0;
  for (; pos < end; )
    c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, step && (at < length && (out[at] = (carry << step | data >>> 15 - step) ^ mask), at++), c >= 128 && (at < length && (out[at] = data >>> 7 - step ^ mask), at++), carry = data & (1 << 7 - step) - 1, step = step + 1 & 7;
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

// stored.js
function trailerLength(kind, length, dataKind) {
  if (kind < 0 || kind > 2) throw Error("Invalid payload header");
  let trailer = kind === 1 ? 4 : kind === 2 ? 32 : 0;
  if (length < trailer) throw failure(2);
  if (dataKind !== 0 && kind !== dataKind)
    throw failure(5);
  return trailer;
}
function verifyStored(api2, bytes, trailer, dataKind) {
  if (dataKind !== 0) {
    let pointer = api2.input_ptr(Math.ceil(bytes.length / 2));
    if (!pointer && bytes.length) throw failure(8);
    new Uint8Array(api2.memory.buffer, pointer, bytes.length).set(bytes);
    let status = api2.verify_bytes(bytes.length, dataKind);
    if (status) throw failure(status);
  }
  return trailer ? bytes.subarray(0, bytes.length - trailer) : bytes;
}

// utf8.js
function runUtf8(api2, text, verifyFormat, dataKind) {
  if (text.length < 8) throw failure(2);
  let kind = text.charCodeAt(1) - 48, header = prepare(text, 2), trailer = trailerLength(kind, header.length, dataKind), bytes = unpack(text, header, verifyFormat);
  return verifyStored(api2, bytes, trailer, dataKind);
}

// compact-guards.mjs
var special = /<(?:\/?script|!--|\x01\x01\x01)/i;
function unprotect(text, verifyFormat) {
  if (verifyFormat) {
    if (!special.test(text)) return text;
    if (/<(?!(?:\x01\x01\x01)(?:\/?script|!--|\x01\x01\x01))(?:\x01\x01\x01|\/?script|!--)/i.test(text))
      throw Error("Invalid payload padding");
  }
  return text.replace(/<\x01\x01\x01/g, "<");
}

// compact-ans.mjs
var digits2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function runAns(api2, text, verifyFormat, dataKind) {
  let raw = unprotect(text, verifyFormat);
  if (raw.length < 15 || raw.slice(2, 5) !== "~c2")
    throw Error("Invalid UTF-8 header");
  let a = digits2.indexOf(raw[5]), b = digits2.indexOf(raw[6]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 7, length = 0, power = 1, d;
  do {
    if (start >= raw.length || power > 1073741824) throw failure(2);
    if (d = digits2.indexOf(raw[start++]), d < 0) throw Error("Invalid UTF-8 header");
    length += (d & 31) * power, power *= 32;
  } while (d & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824) throw failure(2);
  if (power > 32 && !(d & 31)) throw Error("Invalid UTF-8 header");
  let state = 0, multiplier = 1;
  for (let i = 0; i < 7; i++) {
    if (start >= raw.length) throw failure(2);
    let value = digits2.indexOf(raw[start++]);
    if (value < 0) throw Error("Invalid UTF-8 header");
    state += value * multiplier, multiplier *= 64;
  }
  let count = raw.length - start;
  if (state >= 2 ** 38 || length > count * 3) throw failure(2);
  trailerLength(raw.charCodeAt(1) - 48, length, dataKind);
  let pointer = api2.input_ptr(count);
  if (!pointer && count) throw failure(8);
  let view = new DataView(api2.memory.buffer, pointer, count * 2);
  for (let i = 0; i < count; i++)
    view.setUint16(i * 2, raw.charCodeAt(start + i), !0);
  let status = api2.decode_compact(
    length,
    state >>> 0,
    Math.floor(state / 4294967296),
    a | b << 6,
    raw.charCodeAt(1) - 48,
    dataKind,
    +verifyFormat
  );
  if (status) throw failure(status);
  let stored = api2.stored_len(), end = api2.payload_len(), out = new Uint8Array(stored);
  return out.set(new Uint8Array(api2.memory.buffer, api2.output_ptr(), stored)), end === stored ? out : out.subarray(0, end);
}

// utf8-compact.js
function warmCompact() {
  warmup();
}
function runCompact(api2, text, verifyFormat, dataKind) {
  if (text.length < 8) throw failure(2);
  if (text.slice(2, 5) === "~c2")
    return runAns(api2, text, verifyFormat, dataKind);
  let kind = text.charCodeAt(1) - 48, payload = text.slice(2);
  if (!payload.startsWith("~u2")) throw Error("Unsupported payload format");
  let raw = unprotect(payload, verifyFormat), header = prepare(raw), trailer = trailerLength(kind, header.length, dataKind);
  return verifyStored(
    api2,
    unpack(raw, header, verifyFormat),
    trailer,
    dataKind
  );
}

// memory-options.js
function selectMemory(value = !1) {
  if (value !== !0 && value !== !1) throw failure(10);
  return value;
}

// options.js
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

// decoder.js
var api = await loadWasm("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");
function warmup2(codecs, memoryHeavy) {
  if (codecs === void 0 && (codecs = ["pair"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let codec = codecs[i], bit = codec === "pair" ? 1 : codec === "ans" ? 2 : codec === "windows" ? 4 : codec === "utf8" ? 8 : codec === "utf8-compact" ? 16 : 0;
    if (!bit) throw failure(9);
    let flag = memoryHeavy === void 0 ? !1 : memoryHeavy[i];
    if (typeof flag != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit, flag && bit === 1 && (heavy |= 1);
  }
  warmWasm(api, mask & 7, heavy), mask & 8 && warmup(), mask & 16 && warmCompact();
}
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData), memoryHeavy = selectMemory(options.memoryHeavy);
  if (text.length < 2) throw failure(2);
  return text.charCodeAt(0) === 11 ? runUtf8(api, text, verifyFormat, dataKind) : text.charCodeAt(0) === 14 ? runCompact(api, text, verifyFormat, dataKind) : runWasm(api, text, verifyFormat, dataKind, memoryHeavy);
}
export {
  binary,
  warmup2 as warmup
};
