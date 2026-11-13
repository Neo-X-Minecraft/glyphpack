// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function failure(status) {
  return status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
    status === 2 ? "Invalid payload length" : status === 9 ? "Unsupported payload codec" : status === 10 ? "Unsupported memory optimization option" : status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 6 ? "Payload checksum mismatch" : "Wasm decoder failure"
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
  if (!(first === 9 || first >= 32))
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

// options.js
function selectFormat(value = !0) {
  if (value !== !0 && value !== !1) throw Error("Unsupported format verification option");
  return value;
}
function selectData(value = "fast") {
  if (value === "fast") return 1;
  if (value === "none" || value === !1) return 0;
  throw Error("Unsupported data verification mode");
}

// decoder.js
var api = await loadWasm("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");
function warmup(codecs, memoryHeavy) {
  if (codecs === void 0 && (codecs = ["pair"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let codec = codecs[i], bit = codec === "pair" ? 1 : 0;
    if (!bit) throw failure(9);
    let flag = memoryHeavy === void 0 ? !1 : memoryHeavy[i];
    if (typeof flag != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit, flag && bit === 1 && (heavy |= 1);
  }
  warmWasm(api, mask & 7, heavy);
}
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData);
  if (text.length < 2) throw failure(2);
  if (text.charCodeAt(0) === 11) throw failure(9);
  if (text.charCodeAt(0) === 14) throw failure(9);
  return runWasm(api, text, verifyFormat, dataKind, !1);
}
export {
  binary,
  warmup
};
