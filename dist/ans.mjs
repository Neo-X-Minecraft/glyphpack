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
  if (text.charCodeAt(0) !== 10) throw failure(9);
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
