// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  if (text.length < 2) throw Error("Invalid payload length");
  let first = text.charCodeAt(0);
  if (!(first === 9 || first >= 32))
    throw Error("Unsupported payload codec");
  let length = text.length, pointer = api2.input_ptr(length);
  if (pointer === 0 && length)
    throw RangeError("Wasm decoder memory allocation failed");
  if (littleEndian) {
    let input = new Uint16Array(api2.memory.buffer, pointer, length);
    for (let i = 0; i < length; i++) input[i] = text.charCodeAt(i);
  } else {
    let input = new DataView(api2.memory.buffer, pointer, length * 2);
    for (let i = 0; i < length; i++)
      input.setUint16(i * 2, text.charCodeAt(i), !0);
  }
  let status = api2.decode(+verifyFormat, dataKind, +memoryHeavy);
  if (status)
    throw status === 9 ? Error("Unsupported payload codec") : status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 6 ? "Payload checksum mismatch" : "Wasm decoder failure");
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
