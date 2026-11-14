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
  return runWasm(api, text, !0, 2, !1);
}
export {
  binary,
  warmup
};
