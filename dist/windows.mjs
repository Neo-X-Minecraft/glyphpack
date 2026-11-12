// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function warmWasm(api2, codecs, heavy) {
  let status = api2.warmup(codecs, heavy);
  if (status)
    throw status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
      status === 10 ? "Unsupported memory optimization option" : "Unsupported payload codec"
    );
}
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  if (text.length < 2) throw Error("Invalid payload length");
  if (text.charCodeAt(0) !== 12)
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
function warmup(codecs, memoryHeavy) {
  if (codecs === void 0 && (codecs = ["windows"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let bit;
    if (codecs[i] === "windows")
      bit = 4;
    else
      throw Error("Unsupported payload codec");
    if (typeof (memoryHeavy === void 0 ? !1 : memoryHeavy[i]) != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit;
  }
  warmWasm(api, mask, heavy);
}
function binary(text) {
  return runWasm(api, text, !0, 2, !1);
}
export {
  binary,
  warmup
};
