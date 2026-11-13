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
function warmCompact() {
  ensure(block);
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

// utf8-compact.js
function warmCompact2() {
  warmCompact(), warmup();
}
function runCompact(api2, text, verifyFormat, dataKind) {
  if (text.length < 8) throw failure(2);
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
  warmWasm(api, mask & 7, heavy), mask & 16 && warmCompact2();
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
