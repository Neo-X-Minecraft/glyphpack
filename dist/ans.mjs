// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function warmWasm(api2, codecs) {
  let status = api2.warmup(codecs);
  if (status)
    throw status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error("Unsupported payload codec");
}
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  if (text.length < 2) throw Error("Invalid payload length");
  if (text.charCodeAt(0) !== 10)
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
    throw status === 9 ? Error("Unsupported payload codec") : status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure");
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

// decoder.js
var api = await loadWasm("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");
function warmup() {
  warmWasm(api, 2);
}
function binary(text) {
  return runWasm(api, text, !0, 2, !1);
}
export {
  binary,
  warmup
};
