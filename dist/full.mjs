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

// compact-ans.mjs
var digits3 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function runAns(api2, text, verifyFormat, dataKind) {
  let check = verifyFormat, raw = text.replace(/<\x01\x01\x01/g, "<");
  if (check && protect(raw) !== text) throw Error("Invalid payload padding");
  if (raw.length < 15 || raw.slice(2, 5) !== "~c2")
    throw Error("Invalid UTF-8 header");
  let a = digits3.indexOf(raw[5]), b = digits3.indexOf(raw[6]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 7, length = 0, power = 1, d;
  do {
    if (start >= raw.length || power > 1073741824) throw failure(2);
    if (d = digits3.indexOf(raw[start++]), d < 0) throw Error("Invalid UTF-8 header");
    length += (d & 31) * power, power *= 32;
  } while (d & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824) throw failure(2);
  if (power > 32 && !(d & 31)) throw Error("Invalid UTF-8 header");
  let state = 0, multiplier = 1;
  for (let i = 0; i < 7; i++) {
    if (start >= raw.length) throw failure(2);
    let value = digits3.indexOf(raw[start++]);
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
var api = await loadWasm("H4sIAAAAAAACA919e5Acx3nfvGd2HrtzD+D2bg9Az+Dw4AMPiiRIAZSAPuoAwWcEpMTQKaVSIi3RkvbAxz0ISCUQd7RIFaxIFq3IZVmJKowqMZSSIdEqpZJYTgynFMcV02VFiVx2yqkodpWiP1ymHNllupjj5ft9PTM7szt7dyDNf8LjYqd7er739/XXPd292qPLj+uapul3e48Yq6v66iMafcxVvtRXtUccuryySheo0x5xV9V/fFdfNVtNw7RszXBcXQcc29Q1x/HonlxbswL3qYbz+GOPP7n0MUNzPvjYB5784GOa3VQX7//Ak48/9egHVjSn8ZEnnnp65f1PrSxprv/k0yt5wQueevRjF5589IPvv/DYE1rDX155cukxVfDDi48tfeRnPvb+n/7YymPLWuBcenTp8aef0kL/E3+mN/+1bugft1eFsR6vh8ScZmimZmm25miutv7zemIKXeorqSONBalflHo3deWrGxsb7mJqCaOb6MLCfU9o3cQWVmKYp4QmzPVA14Qm426CQuhp1T8F2ZDeQmpEWiAs4Z6xTglHeAuJRhBsoZ8gAIQaGGxpALhGNKQaNQ+EHqwZurkqv/l8eNDQ5qxTuJLff378mKEFximDaEDld54PD2naXKSHRiD/CxcincAbKUM2CMGGvphqMjodgdz76MtYlesbJj0faVMCJLRXZPtp+eLq30GFLvcsEr9H9K98wgrkxoaJkjAhF/OE/s3nLYKyoZ8hIoFP6sc1jUgjERE7rUB+99lx+bouv7E+Jj9ryO8+Pya/c0L+yicj+QevGPJzV0N59aR8+ZOh/A+a/Bx9TUs91sp/U2CJoQbByx1drJLkjINGTLrQDxrtdDe+vG43nV6W8aV0Sv6fH3zrT81usoskaqCBjQbT6R58hdROcLu98rd/8cb37IV0QkyIPcty/BJdCTwxnQpq1RF7l2X7UjrZTRLUegrAeOriy6IWLYDx5Gtf/l//3FpIZghMsiwnL6Uhmh9N94pdYjfDbYhpVI2n0/SUT59YuGKGbzm4ERIPLQAUHqP0mMAm8MQKndZFOy0lkU8I8xrfj+T/fvnad5xuGoiI4AUMLyIqqKWVThC8gKGNdNPRbuIK5uJgmhAq0RC+mOK7U2JXN20w3a1uukuMMGy/m45QkxaKBNUnVujh29NdBHWEnxvvJi0xhdp7CUYkRhlEJDoQHcMYFZ6Y6aZj3cQDKL7vE6Ehg2Qh3ZXOiJjlAYnvEHgkyvjooMF9KeCNMsadDLVNtE+S04wxvAYaiXRSBNTM4QYBoRQB6mdSQzjgdUyJOhfIWDdNu0mDuAtFU8Rc1xJuNw0Zpkv2NcpEjSk9EAFoR8wQ9aMMK+6mTX6OJeuIlJ90xIjYDQmBW3pyjNjZ2U09iMoFImoTQ/aZUHWxg9k26N+dBKWVmcSISBjKmCKXYaVELAuHYHjE3x5qEYpxZQnKBmwRdqmNMoSwm0b8OMljHCogCyE1NMQO0eb6Bplixu+I2KusJWZr2UEVgZgGtzsYVpArfQe4bQjGy9LvdEWT5cb22hJjXWUYbI7UIiB6YiUxsVNMdaGbGea2SVAmoZxWTq4SaJth7SNSnQILGTUcB7KPWY8R3SSbxOPKXHzWfptFMQrdkrgJ9RgUA4cibWa8NtnUmnhOSW6cwDeJNHpknGE1c8mNg1vY7mgmdaUXX8mJuG0zMnDb5BZNokdJPyBu9zC3u5hbONNeKKeVkztS4jYlYsMCi8M2FEL2MVuaQ7ct6NZBfFDCUlbrMAHQrQMzF/tyzTqZ/F1hiJGybseIFJ28hR4Zq+p2LNftaCZ10k6U6zaqcNvTbVNJjLjtsCVPMbcRQZmo6Dbq022Ow2b39zM7jsldmVsf1kcs5cIqc9tgbj2y40K3TiZ/lzDDuppV3Xa2p9u9N6Hb3cztdKZbQ/ib6Lan2ZjtJ8ziSsFtSCa5lW531Ol2hK2rolsEhm3oduKmdDvJ3HYy3XKY2YZurXrd6hDWG9Pt1KBuJ7ejW+UD29Vtwtzqhd/u2qZu99brduaN6nZ6ULe7t6Nb+6Z0O8HcTma6tbapW9Vh1/jtnjeq286gbie257e7bkK3e5nbPYVup7elW4MtuUa3U29Mt/pgTA7I7LahW+smdGtT7gFuJ5jbXKkNDjfgRgk0yrKqXKITnOjU6nY3uJ2o0+0E0jr4Yq7cSUHqzVXgAZuT993NgkSPQ0l2k2HRgGeyoGQy8wE/yy6IX0qRu8k0PeZlmtlNutnZJekpsoxuisgcEZRprpjkcANuVHahLCwQrpIHwdCJNVjQrky7LtLwDpxezyS2C2MBlx93mQCdhkgW6YFaKN1blONRLoxkiChOp8Ukg57Cg4rvSdHGWIBA7CZ9UHKO3AkqbyANJxBJl7LoSW7R6aaTy8cMGl0STF0ldFRNqf8UVWuMfAoIRIfK0xivEb889KDyOI01WmIXE2ChYyHDFMBNVEwr2mlYBHlRA4M9tksjJJcb7CH50U01ajGo4V6+uYcJoJt7CZWlWKah0gyPpY4ZIcE0MFoikqaF4MYG1beZNNIJjWapSMNEsUcBYErj4J8eMpPVgx/Xr+zV5I3RhdSbIUDSv5jS2LErqSXG2edoICBp6N1JJ6S+kHSEJ9fiOEpNKRaSnTQMfZEG3CP0fWOkm7Tpe40MclJqiWeeMlYxLs7/hC8t5PIT52mYrCUWtb36s9Y6Df/XA/MFgHj12by4xr06hrij0l/BOEM0zna4rldM3YV0XDoX04aityEaTO+4PEnkToPcXcSw2012k6A7p2kE6c0tJkL415OfJAoaNCw3MQVR/Y/Q/ygecuP7w258Z9iNG7EYJzmeWiC7bonx+Q6K9EdXqbWQxvK3tPMRZHGDUs0kcejW7m5iEXlTpJZ4IaGhT+rKmIRmkNiEsyDNRfgsBh3OuUgTNDhfEBb5bmidEmESmZjUsA9pGg3ZhY1JB1s4+HJERE3TCNMZ0j0baZWWaMLNi7LR5WmQomyibPbKFspWr2yjbPfKDspOr+yi7HYLyjxQRkxI9EVneJKF4thCmsrLi2TrAVFMVoM+MQ3BtDvH8zXBuUgnPi2iPhAWDcvhlRYRQiYVwMQIJDEXhHrAZtaUGpykKalvdZcSIlmQ4ZAoFi3M+oSKHqknFo3ipIFaC704EB/RtRO6FlB0dReIWFeaK8mYaB40SM4ghdDNw5rF2IJsLyY7QBOhjMTYxQRTTAFLKLUxeRCJHStLBa10l/hWlBZ0Htc89eUYq4RMP020NCGnHVIjdii+ZQJPLWoqjWSKblPc3pELXnorAfVZoWJuBzenbjITefOQ5sh4BVJwUfDAMgjZ0BfJTXI2Vph+kBqIlAQPgBSKqLEB+buF5bmwPFe6i6ltnWJjsjJMiCDEUmZ2NszOrpqdVTY7q8/srD6zs/rMzuozO6vP7Kw+s7N6Zgepw1AqZkdRbLSL2DXSFYn4SeqTGnPkdAZJpCF2nU6tzlJK9rpE9ml1yGZEJzaESR6vGS+NZtGLSy+OquDVIhTTCEfU0wBFFgH3wIIprC3OkQnvpFBqr8AHRtmYPUjJkzcoHjjUoxA4grQekMGowgsoUJgRNiGKEaVGsgJHphFFP4IoXX1/pDtLUV2TFlFqI1bbkOoiRH0xseYwA2oWYM2XRrMSMJovjoYGpTJzUUOAnvnI6BFLhLbLtLXraXupTNuLVdpezGkLyRWJ69OdHo1KCPDexqYECiUoC42YMuoScRvqMDBeRwHaIBJHEx9wu6EXENfoUIQxTzEX/QvlxehSaLxBHumvj6gYjslygz4mYvjX9OQ0HHQ9XH1P88HyJzm4Hn76w/Y/Ln+SW9bDr/7RJ/aUP8mt6+Hk733/75c/yZH18Phfnf8X5U9y+3q49OMn7it/kkPr4fNf+9C3yp/kjvXwQz9odMuf5DYVD6VDsnDXNe1oep/A90teemw98hp+0J6c6oRRszW9a/ee9G51M07vURft9N6aVm9TdSijHnXJ28Xdguo1HS8XHDceGR0b37FzIrlb3CeOqXrU4R7q02PiHnFvTf09NbAJgrinBvYxJlKkb+PvF730zhpi71U34/QuddFOj9a0OlCDlggUB2rQ3iveJu6sIf1t4i5xtKb+zhrYB3owKrDvZyJzYl/waom9U92M03epi3Y6U9Nqfw1aQir216C9cwjpd4l3iZma+qM1sN/Vg1GBPcNEaul+/l7z0n01xB5VN+P0uLpop3M1rd5Rg5aQinfUoD0q9ot9NaTvE8fFXE398RrYBEEcr4G9T1hz3A9YsnW6s7Q+krxzMM1LTq6Hp+i7/ElOSZfi2enkcI2vnqnxaVnj+7M1MeLd5Of3J8fFu5I5IcUdpIiv6eIW+ie9Q5xcf1CcEbeJfem7UHsQtfeLw1R7cD0yTE13XMv2A6/RbIVRehtun6RbD6b75Pj6V3WxT4br1/X1B6C4geYMTRKqB9N3qObvyJonJ8SsOCRmSGuE9Va0u0WcIqx1YE7h9iy1ejCdUWBmcjAz4t3idnIWAnIErW4V7xwC5HbcPkStHkwPKyCHcyCHxUmSwP1if3o/AO1Dy9sUGFKuRsq1SPkeKT9M34mbZ8VBEuNdaHwC5YNDGv8ExaY5ljQ5CljE1SEi+FYKh3R5GJW3D3l4XvFDqkj3y0kQvF+6Stb7cevwEEaPKEb383Pj6rmM0f2E/Ig4LO4DcgZyaAjyk7h5JgNSQZ4cIerfSdEPyiUlnoJ6a2EwgoPEOdQ2qdSWMTCzGQO3KMZnatV9q7iFGLinEOkdQ5CzaN9dhzy5lbQ3T44OYyZ/+AlF5olhZJ7YjMzbhpB5G5F5QhxITxSEbmpQswzmgEJ/ICf0FiJ0P3WdZ+nBgbvUKxFotmp6Fn3RAIWsgH10Cw+Pq4czCg9Q8NovZsTbAeRAboYHaug7pXz4QA19B8VRinZ3klndRRH1Xoq2byPW30Edxn3UmdxDSI5RfzhHfeUJ6o7vpq767dTlH6d0oEjvyRzJYdmmyPtJNSdhTsw5mQdhIPem79vJcGfp+xDiF33fgZhF37fxOCC1ZHxGpacH6fEifOMbH4oclTDNdUd6dQjtqE/fnifmtxGWQTCH1jva+rRBFOHbTO9WmTuy89ShNL3IeI1T1eRcFyPlBHikPgF+IS4lwGtxJQFeiweT8waS8waS84ZKzhkoSVehSu4ObWSvIOFsZGqB+iuyX5uUDwJscTdTBZF09LRxzPgnEMGtKATHjC+gcAsK7jHj8ygcRCE6ZrCkbkchPGZ8GoVDKLSOGVdRuAOF+JjxHAsUBf+YsTaSjWscjGtOr3cMnlPxSIUnkWC/FXKyMK3jDYrrIDFKyTx9f2Ek4fLnR2jgSt8kxQjfnx5JQnxfHUla+H5uJInxTcL1Mbj25DvnSbkeD10hWSuTbAPTfLYIMKVmCxeTfLYgkUHaIaYWbNHChKEtYkyz2cI/lmvASL2eBoyyBgwIPdeAAaHnGjAg9FwDBoSea8CA0HMNGGkTGoDYzcSFEkgHLqbdhJU23mIFYNxGCvCgAK+kAK9PAVGmgDBTQCtTQJwpwM8U0IQCLKUAnjvg0V8jU4BXUUCkFBAqBbSUAmKlAF8poFkowEytngLMsgLM1OkpwCy7gFl2AbPsAmbZBczcBTAPgukWNYxvUJh4y4SPMERWPjCSZ+FbfcJ3bsb6G0r4mLJIvF5cIVwQfkMJvyEcCL+hrL+hrL+hrL+hrL+hrL8Yc1t5pKIaqQW8GGUCk168ZEuJRIuzAoRFwzxT3hjtzmjBZ23d4ylkocv4rHVK/trv/9E39MQAvbr8ES8JSyz5+5/+8s87iS2/cvUz/8wgrqmF/OvPf/3rH008PIzFV9LEpKEhrQVcWbwMLL8K+coACTRyPqhp6uELwunK6JL8tR//j7/42AUC60qrW7rrle96BCdeSAxq5JUbNcqNGnQ3LN+1y3dtYlvghZOJJWwmJq7PQ0wNGV4i9Y9e6pJAXfrXkfqlLgnBUHLFFH9iKClhYmzpvMVXC4mJ+W3wZtIXynh3wfj/3R//51+8fIEelCOX5Nf/4L/+e+MC0W6pGdlsKlUXNuMnUGcjPVDgec0aAWH6LJ6Kdnjqz0x5ptnk6WSlJ4YfFPwZIHwhdXjCjcAvyMvzDI0e0xSl3dKzppoC7BX1SnEIli0vE9Yz5mRNNfVnyNZFYSxnKkmxJC+6uJxJiIvxxeVWZsRf/Li5Y9W9on98ryaPLqRjM5o0ErP3ikP+Bi8OJFkYZOKykZjyu8+HZKJ6soM+5FzJOH0C+kTFM7/6PCaxU/eITk8sNB1dsyiTMQMCPY63FAGZjQHDQJ6FTIEcfDyJ4ASVG1j0R6jMJKKngILc2It1gKDPeNZV603D0PSAqdGYKlCkY7LcSPSsCoROkIeSyxnQKdjRA/5WVRyuBZOsr2CWnF9cUNnIyyE/jSWXDiY7wzkACK/PbmyYn0jaxpXSeyGP5/VhHCbeNJEzOfLZNaAUWmTkFJyOXOLNEW2FCEtAu3fq2uwvv2JeuTz7xVfMZ0IHJDo5iW4gnOvJFJZVGjkhDgghGLOv61fE1OW0PbvReCgi06P2DiRAMVP6F68zVNG+PKs/QxGM6Fm7alCM4HZUnlIQLs9u6M8Ahvsw4czuta8lnnRyeeRkqpKTE42HVZWXVz33qpnX+Xndq7/0Q5ewvPYLf+Y+gynZCsh06gGKWhW4aaeoyuGm00VVDjbdhar2NbmBVIppnRIdRdN0RseuKm62jkwNOgtzgBSdtTOVS47E8uvf29AeygRDxLdZSUHSllYSVl4MetK7mLbIAMg28bYFWicLImlKkYRUltoZESzymlrRkubpTMMmXpyEImDbsvFqDDPrWm6gqCHvzF5C4t0OIdDxVoOiyQpgmRT801GJXGH0fAeVOirjUiXo1t7bs/rwumj/3aJIhYd693TROiMalApIW1UYivA04DeeFCjk73CAIBo9ig1qKXFqyI8iEhry1Y0n1YXblR9dTLFKO8Y617U1hMqTWjqKd7EbY12KSSlcURhidOGUJldJKwFgC506X8BFn4yVxN99fvysUIAQiuYXsUZ5be2jvGhaH5zKElgiPN5d/wek1D3r/5Ja/PJfa1r5s/6vqPLD3sZG+YOB556a95+H1q/p6++h3Aa0xN1afP/9rcIn8L6d+uUuL/iGAmDHGfMoou9kdilgkZjJci/IL7xiLpDuWx0lP6tLTf7bpk08hcZSaMh+VG/ZvkYKvMEaPkcyf4mjPOcuchWrzBc+dJGAtGeN93Uw6jVATCdpGaf6zKJV2IOB/tUQJmrNzCgMdJwUU9kkRslEduLF3KjYyWZBXRzwwR5MGIae+IEYEwYStTGVqI0dRD2bhaf8lGosyqBuZEYEyvEESfDbuYG9jAsRLtB14cTKvWhoHfBCeK6DB6ZYhUD8Xlyg5Ae9oolERKLnt891pElVCCaCY1iqZV2KCpla1qEUcV7VFbH/L77xJ681ryDW/MMv/+C1nc9Q77Kx8Zt/s/th6jpsfnWYNhZSUj1GD+dLyBpZN1VB5dWg8vtRTQ1B5dwUqmYNqrgfVWcIqsZNoRqvQbWzH9V0DSol1OYzyaSYyi/bopNfTonp/LJDRIWUxSHVgEMgA/XwUlk+S4mlg3QESbgIsBLIEZPXlk9orP/zSLvVWzjQr/XRPzkbX836d+pnJ5k49+/xW/sGsto6nieLB4huDflRQ/VdPl4sU9evkGcQeLhTL7x2BXm7h5zptmoJbveQtzFFQbADXvZCiKdKXJubcT1VQTzVx7VVS+xUD/FUzjUhdoC4s12OOxXEnW1x3Okh7hQcB2oEE+ANO7JVXZgYSgTZIKWBRE9fRC98kSyCemxU8gCNBkxkHilW9R3XNNWaN7pQCCXVrr1ufgKZhkWRyg4QC7GA0KH0Ac0VfjOoWJazfct62FoVjg0Xy43L2cq4AhIlhYjTzIIaY4KmdpUF3qvTAAvtQRYaFRbMTHdbs1Brn4oFlauBDauWjYqZ9tgwTvdpYupaavZrIgAbU4NsBGDDrGgiUI5Xtnhn+xZf1kY9GwNGr9gwFRuBYoPo6pS1EbAuhI4Y1dlCG8E2aK91mocxoEm0LAkdZk0V39GU70ir+EODNfrPe08HAs+u2sXVZHFFVJ7pcOcd+ixzSkLmIoxGeCTIQ9RSJ8zdMpIIpk3L0/l++tL2AyqX5jU6KYui17hPDunkA5yMYPlO1rS2GQYKmRvRIIH4GujCwdSNv9n9vt7AgfvxTWBOAibWBW2JGIuFNmvUQaNsCDN5meQ/tNcvU+dshzp3a8RkdkubNZpGo05B3fTwRKFMXWM71PndLRE7Mti00S41BDSJrpzCXW8uv1BJRSnNGJJfDM0thhorMVR0wUVXIKa3n2YAgpXb8XQ126jLNIxhQIoOud1HRn/CMZQRKwvnGRmb5h3GltKY6iNjavvSmCqTsWkWsrU0On1k9JKRXpdibaZeK3eU6W3nJptkJn6RmdT3h9XMxBraHyrC9c0IL/r8IXZZ7haN2rDNcqwxzUquEiimAs5VykwFQ3IVq+gdC6aCcq6yPaaGWHl/2mIO7ZOYuT6Dr8tg/JvKYP52NDbEd7apsRr36c9n/JvKZ6xh+Yy+JSdD3K+X1vRUZWymKiNLa/qc8c1lOXovxTFCM5ttWBVuEgoviYWFOZRi5oG8/Szvs8/nGywU7cTHPDmPR7Yz95BN15anHvLpWq00q6umTMmoX/uFPwu4r/ux+7DKs/iNw0Lq8qDdPc90wBhCnoscGLT7g5jDGszNPsyTdZgpqbgJzKODmMdrMO/swzxVhzm8KZ6nBjFP12De3Ye504+5fU1i0hqrBCbzS+rY8kvkRPESbDKvcfgFo4X5VI9suZG4IsCeicRCAh+rRONnn/MuJKNkeRGfNuEXo7Mmb2QvexN98ZS2fF2/0M1ea2xs8BDWF030obz1ve8JM2/O02PkNc1ANTfQFE5U91SjjMct8DCBZi1lboHHJWiqU9yan6CMx94OP3aBx74JfpwyHms7/FgFHqvgBztO0dOvyLW1/+tioYhHl6+biyptXFoiPO2VJTG6fIxC/QimcHfSF/loE3uZsH2QTMbGJg28TxY7eylCU0Vj5oM46QpTxNxhZCRmEbSOUnPQJuZV3+DgWYsfcrYwC/QJhB6LkbgrJwEuUXdA16DH6fJJB9ujxx20nfm8I44UTUYtTWUTymnyVOdLGqiSYytyGCSTpG9Gkj1oZmUR1ZPTb2mKHFORY1bJscrS2ZQUa9AS53vDekc9X0dO2SDrRvUWGeWadaZDdGcXbn5h5hdEHvV1USAiDOoxgxmkWX/HXV2Ud3UkVz9fIVEzsPc3G9j7fQN7f+jAvjSs14eNrrXSOF0fNsjVJFJTvHzlwb8K653+jpOE8Jfu+yJjqjSq1zcjzt4Occ6WxJWG6UNzJHAwxRzwBIHiYHpIB8wc5IP6TYlrbIc4f0viSqN0fdgoHRx0shfgA+97+ztyQw3Dt0FctB3imlsSR41amzbazRyQsU4zDx3QrnjYPTQlsCk3dHqJgdNLDDyVC0z1EoUiLQh6aYFDwdfDXnBsWKxJCzglCM/zuAXH9kT90YSdN+9f8z5OmH3ZQYhuxeLn+/rF1J2L8rRAdQnYr4dOIVBPmcOeKnrbPCNRD1ZyhfB8hrWfag1YOdoLbSBlCM9nWPufsku85vkJ1jpVModNeLVKvHJsF5aK7pvyapV4zbMV9WAlj9icV6vEa1860eilE16RTjhZOhH0pxN+OZ1wsC6TjLBBERszDn5dOuH3pxOhmsGqtydvrtd75XkFlqQNZhaFmvr6qdSBwJQtOdtKMPz+BCNUPfIgdY0SdXmWgbVwg3mGryjsMVpLpVuicpOUw6+kHNsl0K4SaN+M+OwSYZskH35/8jGUsLJerape+3OQnvT0zaSn52Nwq0Sr9UZSkpBSEp+SeMbN+QgfcqeWtMB6sI4r6I3GLaz4TEz6uPl0LYdLNe62U96Du4TxOJZ3Yie7op+CspZYWLjJ+40DZCdatlVcx35rGkd4pYQLK02NEte8SqMrv/iKyTGDFYp1ZciLrBVBAb+FRUHCAr2a/NE3/uQ1Zz7C2jfgcaWlllrldxbwIIS0cJFv6liD1Ma1Sw+Y2O/NL/0i0WL/Dzhb4m3hWNSJ1ZItod5iZLRTZOgj39kG+Zhw0XjzdkwC1jAji1kNUMVrGnNqLUWjKTH5zqvhwJSW18c57RbRTpS3QHnMlPPe6uC8EgXdyOi2C7q9frr9IXSjg+jRrUHsGd0W0WOxEyuJ2tirm9PeR7fFdNu89526fFfRbks34IUwFcqdEuUuaHeZdregPeynvbkN2nFohrki7KXEJtpNAoU+opA0c2ESF7GSrVWWOc5wyOpt0B33ZI6TEESUUe7BOd0uv2ejHD6Yj7D4OsYhNhpHd6rUz3HuHwQhDknAAl03P97AUb1xcJY7VU05ENbT8sILUwQcTm7OazC7louATZi9JoT65tjuWALnmM1YUcHHHKg3ThZWEYcFy2z5SrNK5diebZeEqJ6FTnEqDtYG8uJjXt5Gag0hJpsZxktMGtogNhNPdnY/P0YgdYPUnufHbKqm6FmcgOEqp8RZlOf5aZOf5mbxxfycAQZALbAGT91rX8zPHAAIOG7isUQxHJrPevHGXP76n+pZLVi8fQ5nd7KqqbAQR1NSq47hWhQgQ6GW65qZj/qVQBkPC5St7QbKqFCysdLFojIE2ZIVdKUmf/jCZaF1utKojZb+Eg0w31y09OuipZ95bk209EvRMiqCY8YAjKQaQHMezEEeeiGz+WZCZrMvZPpdPrhyMGT6OfF2Qbw/IP1KFO1TQH3cbL7ZuNmsxM0K+dW46VfjZlSEyQoD4fYY2G7w9IcET78UPP2+4Bm/oeDpbxY8W5sGzwFPMus9KbPCmgjqV/IOu+xJfl8MzSOlXxspef5JRdlWIRv2GOi3RbLhVyDlGNraIoa26mNoa3sxtLVJDG29FTGUF4Ij08zCaJCFUCuTZVgJo80sjDZUGM1CTZZEZ5e9yKqMIBa8XpsjqykaaoLM5ZVcKOEAmbg6eOSqSo+KZB4+4JW61rTwDkQguxRfbWanbBUhOTJFePAKV7HJILgKb1PKns/xNSRH9+DhkLuF+NpkF2nwkrJ53ovh8iYb0G8zseUoirfdqraci6YRai3BG4N8EZU5cXt+7iLKhswJR1k3i7KKXK3n9QN+nvNYy4bdYwNbdkC4nrFhl9jw+qYBVK0/wJyt2MDBL5uz4Sk2sE+hYCXahA1qR6xEebyF9RErUYkNr2DDqbDhltgIa9lo9hkUa6NMv5XTr87zS0eEgfhOhpe6KyJaSsMMM0IlEg/oh0DkUQUbviiEItrMWsmkirleWUc21xfxOMxjjj1rUj1FupEun+ZGobaB+Bsj/rIDEehK/G0EPC2i1mg2ykE3NpWBNjjg4uVK1cHCOVVVdbAItTCxcIhp4mRu5WRIXtnFoiJ5BVu82y1188jB5x5xpMIgHmwpbplTV225Up7IwuK2eBrpfC5RvDsMSd8Y5wqdfZui11neleflO4yByCB7FBGU46rFWqoC0dLjRa9B6qpQTGYSZaHY5W12AfdGOMsSodjLQjE3U6EYVQwgD8V8r53dUypAAEhiFnkRiqWR4IBMC28RHFKR0K8L6/ozYhKz89pPLVIcRBbi4z3rrPlTEglB+5o0Vy52OPl0syCukjy6RtQmqRVR2yWM+UyYmbRUnsLBO6oEbd5aLsoh2+2FbLccsuPMhPy6kB1WQrbfH7JbvFir1KtbKmRbXT74v5zJkDM1ORXDhl8YklWO1VE1VsOduAonhpWjRlNFhmqQa4qRaqyuxGm/Gqc5MrR4WVWJ7mYR4HB+epPJL9LgpkqDoyUyyWoaTKbAzDWrNJacn1uoAA37obJJ5Yx2GFVGexGgK8HZrwZnO6e9khVnfYzLWxlFxLRbveTJAu1ej3atlBLZLGNLcaOSxXLgKjoXRCsInXmood0paHdLtIcDPSFobw7I3RV8plyUyd3rdfHcFY9Q+KcgpC2lUTUU27yqrujLOeio6NLshWK3MijJQnFT3WONNIk5Nw/FnBX2QrGPUMyOQZKphGIvUBt9i1DMzlL4Et5oZI5j9DmON8dzl32Ow6HYxsEAmQYL68MufeU80CC7TlwTgz0OBE3lQ5bKEnHuX2JnbPZisJ15WLPyNCamezHYZe1iCF3EYE/FYCs/ZECFXFJQDK14eQxGRX6GIUKop2IwheY4i8FeFoNxTGHqqRhsZTGYm6kYbGUx2MtjMN9rZ/eU7OHciT8Qg7G9yi7HYLs/BlMP04vBUSUGh/UxOEyxM03smFOLKLGJC3u/LCnEeIfanVH71sYhpOxmap6NTIYgrTORGrkf1BhwbJ2m0eDEIqKfdGj4p8Q3Mae2OmJi+OVsYpgXWQLQmGx1+dkMpsBJsOhQATfVcHaYGKN/W+sz6+8VKMdc3oPyktQX1fIvrGwbk0e7M+RK+c5sLfi5EcNbNa6ondnRDN4RuqU9pqQrtbfypNo+t6HP80twjKixwox7POuQ9pXnLRooQBH5Zm7/+qx5JW3NiqsPkKu0rs0vRtmuN2GrDasExsYciH0a57DSk2qkZZzK9v8J7XxvByCfS+rRCD3b5mdhm5/OR1Rik18gdbkK38P+QHJADUfaphxfqAc7yy156x8u8o1/4UmKRPPqrVq2H5Tkj417Qb4f1MIF9vR5fK4nmZRxfVZ88jnqgrGtT8u39VEwwLY+rCuEUhv59nRDGsLvlDfu8oEjPs8KJVZoY0s5jiHhc3tXEAIQLHS5xksT6TumADu7tvbrThJjr4XebLpG6T/XwKEOaz8yF+XaS+bpyKHS+oY5zxcvUYfMv3wjzkYOAQEMeE+O3cA5CXwwTKjQ09hfw3EcaqM5Bq4LqQOCDEUQCAVJ2bjIKCEOqcSIcVFGHIoWUL+PEhmywBbz8lCEjbSW8ik3jAI+HyUl2Z3lc2Q9vNFrXePXPi1+IR0+LHRSZmvWu5q0KNsgcwjCVlCGEm4JJagD0ixU0Gz65W2xPg4gJWaiebm6jBOhDfnnMEnm4eovuQ/xLxTdBBOf/VqzSoCZcWEomJ8CTO3mYP6jfphGBpNaUUL/H3/XfCLBHpZvffMy3mGT/aLuwnUy5dmJTz53GfbALb+dt/yNXss/1xauz9KNK6r15cuzv/JXnzIv835yPPOl7JE/LZ74knlB/uCF3zK71/NH+MUPGmdtn8mbrj2FECY3ftOc73TlI1x45TUurMULiB4F1h98/y/Ny0HSwnu7M+qMYiUupQiCqnSkd4nksx2ycow0MxlmRkex6sHIQBqODfA8J6h65Pgh9NXKDYw37QaN3A0afW7Q2NoN/Bptt64Jcys3CCtu0NgSSq0bBCU3cMtu4N6cG2zNxBA3CIe7wdYwh7hB+P+1G/Rs3CjZOA81swGf6m75iAhsMc/zE13w6cQNoccWH+2iU6aC4yEczip00UC+cqbDkLX+xyLJv8Wlx6Z6kozb5HwEP9GT5SNRXz4SVfMRF0k4pyJuLxX5PV138h+KS/XqT8XhK+FEi1K1d/OeOWTWZIv/pjgrQHW5fCgLCRjpAaUEBlKC1OSkgPKlToqfycsOiuDjA87yCUdZbmDI17PcwKLcgGd0KT/p5QaEondWBHb3Az0fEkAoEwe5D+cEgXCChpblLrhSEsTVt9XV/zQNdzU/EcedwaAb4y4DZ2AUqYLOmtM1Ayd64HAPO98baqjl+SrXIkGoM4EMvJPJxID+n09Cd4RFWtYwbGL9Yt24k+nXZP3SYKnV5d9wsmIzm1bAJlBeYU6JP6W52gKJmgPeHrphyD3nO1SBTF+2cORGLPQO7JpurS7zYErw0higonovOziDj67Av+sPisb6A0mDD5rgn/eL1e8Hxl11JmIDf70TZ4ujKh5Iszs4tLByiEVxxzD7jrco7uj9B188sL6TWA0UmSARb9Io7+R1r3ywEstGXVL/spRk25JNKfinA9nsMf/SQcLultLr37ENixQsGzhlilTlIjf2mVXk0AILTFaXF1mNJg4/0eLMvrHXov73EvNfRsRwxeBfRzTVryOa/OuIlvp1RKv864gW/zoi5hkrv45o1v46Il5YpLb6dURr6K8jIrIQGzgypnQui1F4rjqAQ8/PZcndTVPnsmR5OIstO5PFJF/Tef6GjKZyLotWzsNJNHwui1ZzLgu6IK3mnBS9dy6Lc3PnpDibn5Oi1Z/LovfOZfnbxifUURHKV1I9+6mGjHm+kbPLKycrh66YHSU/Mm69OJelvgm/GsQJLoyCRvbBJ03dXi1OkxPqNBb+VQ2NjzKjIEEOIbRzbHv6AlqgZ8Kojk+R418QMJSlDv6oQXEfP6Wgrpziyi6urOLKLK6Mbg+2uuKfKqW4nv1AgVAHrpFNXl7s8tk/fGQa//aFOs6MIyl+pxS/2JCd12bgWHzjHNsosaPjpxpM69QALyavG3zLeLEqvNDnhm1o/BO0X7U/sPToymPLR9Svzi4duvTo8uNHlpc+cOTplZ+5N/8R2sNLy9qwdpc+8sQHn7y0vFmTR5/Y9PbTTxCOhc1aHD6c/Y/Chx9d/vBmjS985KdxGz8icID+HaNPgz7zVN5N3zIr4xxwnPuNc75xrjd+TwC/H4DfC8DvA3ya2t9O7X5MH4qUWl5+VUPY7JV/SJ/pUvkPM5x5+T/R545S+WX6jJTKN+hzhD5dKif03abPOH0Oapgj17T7M3p/VTxL0fZz+m6xXwiRiN82jopH9LeL9+if0Z7RP6u9oLXxs09il0jFmBgXf2ykyaP6cfFe/UvaFf2j+r/N+P9d6roepu9y+c5S+Q+pvK9U/h6VD5fohSwmSmXIYlep/bOGpp0rldeonJbKn6Hy/lL5U1S+tVROqHyiVD6atdewXoEyksC2UPh/hN3+FZt5AAA=");
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
