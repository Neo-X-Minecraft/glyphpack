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

// decoder.js
var api = await loadWasm("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");
function warmup2(codecs, memoryHeavy) {
  if (codecs === void 0 && (codecs = ["utf8"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let codec = codecs[i], bit = codec === "utf8" ? 8 : 0;
    if (!bit) throw failure(9);
    if (typeof (memoryHeavy === void 0 ? !1 : memoryHeavy[i]) != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit;
  }
  warmWasm(api, mask & 7, heavy), mask & 8 && warmup();
}
function binary(text) {
  if (text.length < 2) throw failure(2);
  if (text.charCodeAt(0) === 11) return runUtf8(api, text, !0, 2);
  throw text.charCodeAt(0) === 14 ? failure(9) : failure(9);
}
export {
  binary,
  warmup2 as warmup
};
