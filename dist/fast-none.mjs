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
  warmWasm(api, mask, heavy);
}
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData);
  return runWasm(api, text, verifyFormat, dataKind, !1);
}
export {
  binary,
  warmup
};
