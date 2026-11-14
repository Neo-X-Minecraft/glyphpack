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

// compact-core.mjs
var counts = [126, 1920, 61406, 1048544], block = 4096, digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", ways = [1n];
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
function protect(text) {
  return text.replace(/<(?=\/?script|!--|\x01\x01\x01)/gi, "<");
}
function prepareCompact(text) {
  if (text.length < 6 || text.slice(0, 3) !== "~c1")
    throw Error("Invalid UTF-8 header");
  let a = digits.indexOf(text[3]), b = digits.indexOf(text[4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 5, length = 0, power = 1, d;
  do {
    if (start >= text.length || power > 1073741824)
      throw Error("Invalid payload length");
    if (d = digits.indexOf(text[start++]), d < 0) throw Error("Invalid UTF-8 header");
    length += (d & 31) * power, power *= 32;
  } while (d & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824 || length > (text.length - start) * 4)
    throw Error("Invalid payload length");
  if (power > 32 && !(d & 31)) throw Error("Invalid UTF-8 header");
  return { start, length, mask: a | b << 6 };
}
function unpackCompact(text, { start, length, mask }, verifyFormat) {
  let encoded = text.slice(start), body = encoded.replace(/<\x01\x01\x01/g, "<");
  if (protect(body) !== encoded)
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
      if (cp < 128 ? (w = 1, d = cp - 1 - (cp > 13 ? 1 : 0), (cp === 0 || cp === 13) && (d = -1)) : cp < 2048 ? (w = 2, d = cp - 128) : cp < 65536 ? (w = 3, d = cp - 2048 - (cp >= 57344 ? 2048 : 0) - (cp >= 65008 ? 32 : 0), (cp >= 55296 && cp < 57344 || cp >= 64976 && cp <= 65007 || cp >= 65534) && (d = -1)) : (w = 4, d = ((cp >>> 16) - 1) * 65534 + (cp & 65535), (cp & 65535) >= 65534 && (d = -1)), d < 0 || d >= counts[w - 1])
        throw Error("Invalid payload character");
      if (w > remaining) throw Error("Invalid payload length");
      for (let j = 1; j < w; j++)
        rank += BigInt(counts[j - 1]) * ways[remaining - j];
      remaining -= w, rank += BigInt(d) * ways[remaining];
    }
    if (rank >= 1n << BigInt(size * 8))
      throw Error("Invalid payload padding");
    for (let i = size - 1; i >= 0; i--)
      out[at + i] = Number(rank & 255n) ^ mask, rank >>= 8n;
  }
  if (pos !== body.length) throw Error("Invalid payload padding");
  return out;
}

// compact-ans.mjs
var digits2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function runAns(api2, text, verifyFormat, dataKind) {
  let raw = text.replace(/<\x01\x01\x01/g, "<");
  if (protect(raw) !== text) throw Error("Invalid payload padding");
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

// utf8-model.mjs
var digits3 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", forbidden = [0, 10, 13, 34, 38, 92], ranges = `\xC0-!\u0272\x90$!#"$!!$#!#!!!4!\u0100'\xC6!F"R"#N!!!"!"!);$&1*+!!N50!\x85(!&""!$@"!!>=y+!.K)'#"`, table;
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
  let a = digits3.indexOf(text[offset + 3]), b = digits3.indexOf(text[offset + 4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = offset + 5, length = 0, power = 1, digit;
  do {
    if (start >= text.length || power > 1073741824)
      throw Error("Invalid payload length");
    if (digit = digits3.indexOf(text[start++]), digit < 0) throw Error("Invalid UTF-8 header");
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
  let header = fast ? prepare(raw) : prepareCompact(raw), trailer = trailerLength(kind, header.length, dataKind);
  return verifyStored(
    api2,
    fast ? unpack(raw, header, verifyFormat) : unpackCompact(raw, header, verifyFormat),
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
