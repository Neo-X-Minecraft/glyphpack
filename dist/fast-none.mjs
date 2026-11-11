// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function warmWasm(api2, codecs) {
  let status = api2.warmup(codecs);
  if (status)
    throw status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error("Unsupported payload codec");
}
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
function warmup() {
  warmWasm(api, 1);
}
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData);
  return runWasm(api, text, verifyFormat, dataKind, !1);
}
export {
  binary,
  warmup
};
