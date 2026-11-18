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
