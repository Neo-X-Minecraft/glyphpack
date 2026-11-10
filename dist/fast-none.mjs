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
    throw status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 6 ? "Payload checksum mismatch" : "Wasm decoder failure");
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
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData);
  return runWasm(api, text, verifyFormat, dataKind, !1);
}
export {
  binary
};
