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
  return runWasm(api, text, !0, 2, !1);
}
export {
  binary
};
