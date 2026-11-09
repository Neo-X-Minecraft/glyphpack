// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  let length = text.length, pointer = api2.input_ptr(length);
  if (pointer === 0 && length) throw RangeError("Wasm decoder memory allocation failed");
  if (littleEndian) {
    let input = new Uint16Array(api2.memory.buffer, pointer, length);
    for (let i = 0; i < length; i++) input[i] = text.charCodeAt(i);
  } else {
    let input = new DataView(api2.memory.buffer, pointer, length * 2);
    for (let i = 0; i < length; i++) input.setUint16(i * 2, text.charCodeAt(i), !0);
  }
  let status = api2.decode(+verifyFormat, dataKind, +memoryHeavy);
  if (status)
    throw status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 6 ? "Payload checksum mismatch" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure");
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

// memory-options.js
function selectMemory(value = !1) {
  if (value !== !0 && value !== !1) throw Error("Unsupported memory optimization option");
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
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData), memoryHeavy = selectMemory(options.memoryHeavy);
  return runWasm(api, text, verifyFormat, dataKind, memoryHeavy);
}
export {
  binary
};
