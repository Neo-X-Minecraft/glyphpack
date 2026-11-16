// wasm-runtime.js
function failure(status) {
  return status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
    status === 2 ? "Invalid payload length" : status === 9 ? "Unsupported payload codec" : status === 10 ? "Unsupported memory optimization option" : status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure"
  );
}
function warmWasm(api2, codecs, heavy) {
  let status = api2.warmup(codecs, heavy);
  if (status) throw failure(status);
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

// compact-guards.mjs
function protect(text) {
  return text.replace(/<(?=\/?script|!--|\x01\x01\x01)/gi, "<");
}

// compact-ans.mjs
var digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function runAns(api2, text, verifyFormat, dataKind) {
  let raw = text.replace(/<\x01\x01\x01/g, "<");
  if (protect(raw) !== text) throw Error("Invalid payload padding");
  if (raw.length < 15 || raw.slice(2, 5) !== "~c2")
    throw Error("Invalid UTF-8 header");
  let a = digits.indexOf(raw[5]), b = digits.indexOf(raw[6]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 7, length = 0, power = 1, d;
  do {
    if (start >= raw.length || power > 1073741824) throw failure(2);
    if (d = digits.indexOf(raw[start++]), d < 0) throw Error("Invalid UTF-8 header");
    length += (d & 31) * power, power *= 32;
  } while (d & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824) throw failure(2);
  if (power > 32 && !(d & 31)) throw Error("Invalid UTF-8 header");
  let state = 0, multiplier = 1;
  for (let i = 0; i < 7; i++) {
    if (start >= raw.length) throw failure(2);
    let value = digits.indexOf(raw[start++]);
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

// utf8-model.mjs
var digits2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", forbidden = [0, 10, 13, 34, 38, 92], ranges = `\xC0-!\u0272\x90$!#"$!!$#!#!!!4!\u0100'\xC6!F"R"#N!!!"!"!);$&1*+!!N50!\x85(!&""!$@"!!>=y+!.K)'#"`, table;
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
  let a = digits2.indexOf(text[offset + 3]), b = digits2.indexOf(text[offset + 4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = offset + 5, length = 0, power = 1, digit;
  do {
    if (start >= text.length || power > 1073741824)
      throw Error("Invalid payload length");
    if (digit = digits2.indexOf(text[start++]), digit < 0) throw Error("Invalid UTF-8 header");
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
  let out = new Uint8Array(length), end = text.length, pos = start, at = 0, carry = 0, valid = 0, c = 0, entry = 0, data = 0;
  for (; pos + 8 <= end && at + 15 <= length; )
    c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, c >= 128 && (out[at++] = data >>> 7 ^ mask), carry = data & 127, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 1 | data >>> 14) ^ mask, c >= 128 && (out[at++] = data >>> 6 ^ mask), carry = data & 63, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 2 | data >>> 13) ^ mask, c >= 128 && (out[at++] = data >>> 5 ^ mask), carry = data & 31, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 3 | data >>> 12) ^ mask, c >= 128 && (out[at++] = data >>> 4 ^ mask), carry = data & 15, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 4 | data >>> 11) ^ mask, c >= 128 && (out[at++] = data >>> 3 ^ mask), carry = data & 7, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 5 | data >>> 10) ^ mask, c >= 128 && (out[at++] = data >>> 2 ^ mask), carry = data & 3, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 6 | data >>> 9) ^ mask, c >= 128 && (out[at++] = data >>> 1 ^ mask), carry = data & 1, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 7 | data >>> 8) ^ mask, c >= 128 && (out[at++] = data ^ mask);
  let step = 0;
  for (; pos < end; )
    c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, step && (at < length && (out[at] = (carry << step | data >>> 15 - step) ^ mask), at++), c >= 128 && (at < length && (out[at] = data >>> 7 - step ^ mask), at++), carry = data & (1 << 7 - step) - 1, step = step + 1 & 7;
  return finish(
    valid,
    at,
    -(end - start) & 7,
    length,
    data,
    c < 128 ? 7 : 15,
    end > start
  ), out;
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
  if (fast && !0 && protect(raw) !== payload)
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

// decoder.js
var api = await loadWasm("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");
function warmup2(codecs, memoryHeavy) {
  if (codecs === void 0 && (codecs = ["utf8-compact"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let codec = codecs[i], bit = codec === "utf8-compact" ? 16 : 0;
    if (!bit) throw failure(9);
    if (typeof (memoryHeavy === void 0 ? !1 : memoryHeavy[i]) != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit;
  }
  warmWasm(api, mask & 7, heavy), mask & 16 && warmCompact();
}
function binary(text) {
  if (text.length < 2) throw failure(2);
  if (text.charCodeAt(0) === 11) throw failure(9);
  if (text.charCodeAt(0) === 14) return runCompact(api, text, !0, 2);
  throw failure(9);
}
export {
  binary,
  warmup2 as warmup
};
