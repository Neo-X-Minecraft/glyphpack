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
  let first = text.charCodeAt(0);
  if (!(first === 9 || first >= 32 || first === 10))
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
  if (codecs === void 0 && (codecs = ["pair"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let codec = codecs[i], bit = codec === "pair" ? 1 : codec === "ans" ? 2 : 0;
    if (!bit) throw failure(9);
    let flag = memoryHeavy === void 0 ? !1 : memoryHeavy[i];
    if (typeof flag != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit, flag && bit === 1 && (heavy |= 1);
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
