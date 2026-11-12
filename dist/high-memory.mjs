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
  if (codecs === void 0 && (codecs = ["pair"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let bit;
    if (codecs[i] === "pair")
      bit = 1;
    else
      throw Error("Unsupported payload codec");
    let flag = memoryHeavy === void 0 ? !1 : memoryHeavy[i];
    if (typeof flag != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit, flag && bit === 1 && (heavy |= 1);
  }
  warmWasm(api, mask, heavy);
}
function binary(text) {
  return runWasm(api, text, !0, 2, !0);
}
export {
  binary,
  warmup
};
