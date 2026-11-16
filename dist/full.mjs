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
function protect(text) {
  return text.replace(/<(?=\/?script|!--|\x01\x01\x01)/gi, "<");
}

// compact-ans.mjs
var digits2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function runAns(api2, text, verifyFormat, dataKind) {
  let check = verifyFormat, raw = text.replace(/<\x01\x01\x01/g, "<");
  if (check && protect(raw) !== text) throw Error("Invalid payload padding");
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
  let kind = text.charCodeAt(1) - 48, payload = text.slice(2), fast = payload.startsWith("~u2"), raw = fast ? payload.replace(/<\x01\x01\x01/g, "<") : payload;
  if (fast && verifyFormat && protect(raw) !== payload)
    throw Error("Invalid payload padding");
  if (!fast) throw Error("Unsupported payload format");
  let header = prepare(raw), trailer = trailerLength(kind, header.length, dataKind);
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
