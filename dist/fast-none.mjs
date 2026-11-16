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
