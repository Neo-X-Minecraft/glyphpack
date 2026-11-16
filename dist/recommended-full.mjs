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
  if (!(first === 9 || first === 10)) throw failure(9);
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
