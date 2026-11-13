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
  if (!(first === 9 || first >= 32 || first === 10 || first === 12))
    throw failure(9);
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

// compact-core.mjs
var counts = [126, 1920, 61406, 1048544], block = 4096, digits2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", ways = [1n];
function ensure(n) {
  let goal = 1n << BigInt(n * 8);
  for (; ways.at(-1) < goal; ) {
    let sum = 0n, r = ways.length;
    for (let w = 1; w <= 4 && w <= r; w++)
      sum += BigInt(counts[w - 1]) * ways[r - w];
    ways.push(sum);
  }
}
function lengthFor(n) {
  let goal = 1n << BigInt(n * 8), low = 0, high = ways.length - 1;
  for (; low < high; ) {
    let mid = low + high >>> 1;
    ways[mid] < goal ? low = mid + 1 : high = mid;
  }
  return low;
}
function warmCompact() {
  ensure(block);
}
function protect(text) {
  return text.replace(/<(?=\/?script|!--|\x01\x01\x01)/gi, "<");
}
function prepareCompact(text) {
  if (text.length < 6 || text.slice(0, 3) !== "~c1")
    throw Error("Invalid UTF-8 header");
  let a = digits2.indexOf(text[3]), b = digits2.indexOf(text[4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 5, length = 0, power = 1, d;
  do {
    if (start >= text.length || power > 1073741824)
      throw Error("Invalid payload length");
    if (d = digits2.indexOf(text[start++]), d < 0) throw Error("Invalid UTF-8 header");
    length += (d & 31) * power, power *= 32;
  } while (d & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824 || length > (text.length - start) * 4)
    throw Error("Invalid payload length");
  if (power > 32 && !(d & 31)) throw Error("Invalid UTF-8 header");
  return { start, length, mask: a | b << 6 };
}
function unpackCompact(text, { start, length, mask }, verifyFormat) {
  let check = verifyFormat, encoded = text.slice(start), body = encoded.replace(/<\x01\x01\x01/g, "<");
  if (check && protect(body) !== encoded)
    throw Error("Invalid payload padding");
  let out = new Uint8Array(length);
  length && ensure(Math.min(length, block));
  let pos = 0;
  for (let at = 0; at < length; at += block) {
    let size = Math.min(block, length - at), remaining = lengthFor(size), rank = 0n;
    for (; remaining; ) {
      if (pos >= body.length) throw Error("Invalid payload length");
      let cp = body.codePointAt(pos);
      pos += cp > 65535 ? 2 : 1;
      let w, d;
      if (cp < 128 ? (w = 1, d = cp - 1 - (cp > 13 ? 1 : 0), (cp === 0 || cp === 13) && (d = -1)) : cp < 2048 ? (w = 2, d = cp - 128) : cp < 65536 ? (w = 3, d = cp - 2048 - (cp >= 57344 ? 2048 : 0) - (cp >= 65008 ? 32 : 0), (cp >= 55296 && cp < 57344 || cp >= 64976 && cp <= 65007 || cp >= 65534) && (d = -1)) : (w = 4, d = ((cp >>> 16) - 1) * 65534 + (cp & 65535), (cp & 65535) >= 65534 && (d = -1)), check && (d < 0 || d >= counts[w - 1]))
        throw Error("Invalid payload character");
      if (w > remaining) throw Error("Invalid payload length");
      for (let j = 1; j < w; j++)
        rank += BigInt(counts[j - 1]) * ways[remaining - j];
      remaining -= w, rank += BigInt(d) * ways[remaining];
    }
    if (check && rank >= 1n << BigInt(size * 8))
      throw Error("Invalid payload padding");
    for (let i = size - 1; i >= 0; i--)
      out[at + i] = Number(rank & 255n) ^ mask, rank >>= 8n;
  }
  if (check && pos !== body.length) throw Error("Invalid payload padding");
  return out;
}

// utf8-compact.js
function warmCompact2() {
  warmCompact(), warmup();
}
function runCompact(api2, text, verifyFormat, dataKind) {
  if (text.length < 8) throw failure(2);
  let kind = text.charCodeAt(1) - 48, payload = text.slice(2), fast = payload.startsWith("~u2"), raw = fast ? payload.replace(/<\x01\x01\x01/g, "<") : payload;
  if (fast && verifyFormat && protect(raw) !== payload)
    throw Error("Invalid payload padding");
  let header = fast ? prepare(raw) : prepareCompact(raw), trailer = trailerLength(kind, header.length, dataKind);
  return verifyStored(
    api2,
    fast ? unpack(raw, header, verifyFormat) : unpackCompact(raw, header, verifyFormat),
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
  warmWasm(api, mask & 7, heavy), mask & 8 && warmup(), mask & 16 && warmCompact2();
}
function decodeRawUtf8(text) {
  return runUtf8(api, "\v0" + text, !0, 0);
}
function decodeRawUtf8Compact(text) {
  return runCompact(api, "0" + text, !0, 0);
}
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData), memoryHeavy = selectMemory(options.memoryHeavy);
  if (text.length < 2) throw failure(2);
  return text.charCodeAt(0) === 11 ? runUtf8(api, text, verifyFormat, dataKind) : text.charCodeAt(0) === 14 ? runCompact(api, text, verifyFormat, dataKind) : runWasm(api, text, verifyFormat, dataKind, memoryHeavy);
}
export {
  binary,
  decodeRawUtf8,
  decodeRawUtf8Compact,
  warmup2 as warmup
};
