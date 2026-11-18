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
  if (text.charCodeAt(0) !== 9) throw failure(9);
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
