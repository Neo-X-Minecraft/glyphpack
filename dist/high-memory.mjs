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
  if (text.charCodeAt(0) !== 9) throw failure(9);
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
