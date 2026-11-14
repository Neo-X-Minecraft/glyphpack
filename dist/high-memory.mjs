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
  if (!(first === 9 || first >= 32))
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
    let codec = codecs[i], bit = codec === "pair" ? 1 : 0;
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
  return runWasm(api, text, !0, 2, !0);
}
export {
  binary,
  warmup
};
