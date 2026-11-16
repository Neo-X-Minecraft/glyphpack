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
  return runWasm(api, text, !0, 2, !1);
}
export {
  binary,
  warmup
};
