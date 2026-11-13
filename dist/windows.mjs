// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function failure(status) {
  return status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
    status === 2 ? "Invalid payload length" : status === 9 ? "Unsupported payload codec" : status === 10 ? "Unsupported memory optimization option" : status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure"
  );
}
function warmWasm(api2, codecs, heavy) {
  let status = api2.warmup(codecs, heavy);
  if (status) throw failure(status);
}
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  let length = text.length;
  if (length < 2) throw failure(2);
  if (text.charCodeAt(0) !== 12)
    throw failure(9);
  let pointer = api2.input_ptr(length);
  if (pointer === 0 && length) throw failure(8);
  if (littleEndian) {
    let input = new Uint16Array(api2.memory.buffer, pointer, length);
    for (let i = 0; i < length; i++) input[i] = text.charCodeAt(i);
  } else {
    let input = new DataView(api2.memory.buffer, pointer, length * 2);
    for (let i = 0; i < length; i++)
      input.setUint16(i * 2, text.charCodeAt(i), !0);
  }
  let status = api2.decode(+verifyFormat, dataKind, +memoryHeavy);
  if (status) throw failure(status);
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
    let codec = codecs[i], bit = codec === "windows" ? 4 : 0;
    if (!bit) throw failure(9);
    if (typeof (memoryHeavy === void 0 ? !1 : memoryHeavy[i]) != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit;
  }
  warmWasm(api, mask & 7, heavy);
}
function binary(text) {
  if (text.length < 2) throw failure(2);
  if (text.charCodeAt(0) === 11) throw failure(9);
  if (text.charCodeAt(0) === 14) throw failure(9);
  return runWasm(api, text, !0, 2, !1);
}
export {
  binary,
  warmup
};
