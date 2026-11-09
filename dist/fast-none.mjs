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
