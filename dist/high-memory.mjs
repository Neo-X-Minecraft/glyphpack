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
  warmWasm(api, mask, heavy);
}
function binary(text) {
  return runWasm(api, text, !0, 2, !0);
}
export {
  binary,
  warmup
};
