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
  if (text.charCodeAt(0) !== 10)
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
  if (codecs === void 0 && (codecs = ["ans"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let codec = codecs[i], bit = codec === "ans" ? 2 : 0;
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
