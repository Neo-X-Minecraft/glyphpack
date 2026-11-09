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
    throw status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure");
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
function binary(text) {
  return runWasm(api, text, !0, 2, !0);
}
export {
  binary
};
