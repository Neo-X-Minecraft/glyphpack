// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function warmWasm(api2, codecs, heavy) {
  let status = api2.warmup(codecs, heavy);
  if (status)
    throw status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
      status === 10 ? "Unsupported memory optimization option" : "Unsupported payload codec"
    );
}
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  if (text.length < 2) throw Error("Invalid payload length");
  let first = text.charCodeAt(0);
  if (!(first === 9 || first >= 32))
    throw Error("Unsupported payload codec");
  let length = text.length, pointer = api2.input_ptr(length);
  if (pointer === 0 && length)
    throw RangeError("Wasm decoder memory allocation failed");
  if (littleEndian) {
    let input = new Uint16Array(api2.memory.buffer, pointer, length);
    for (let i = 0; i < length; i++) input[i] = text.charCodeAt(i);
  } else {
    let input = new DataView(api2.memory.buffer, pointer, length * 2);
    for (let i = 0; i < length; i++)
      input.setUint16(i * 2, text.charCodeAt(i), !0);
  }
  let status = api2.decode(+verifyFormat, dataKind, +memoryHeavy);
  if (status)
    throw status === 9 ? Error("Unsupported payload codec") : status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 6 ? "Payload checksum mismatch" : "Wasm decoder failure");
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

// options.js
function selectFormat(value = !0) {
  if (value !== !0 && value !== !1) throw Error("Unsupported format verification option");
  return value;
}
function selectData(value = "fast") {
  if (value === "fast") return 1;
  if (value === "none" || value === !1) return 0;
  throw Error("Unsupported data verification mode");
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
    let bit;
    if (codecs[i] === "pair")
      bit = 1;
    else
      throw Error("Unsupported payload codec");
    let flag = memoryHeavy === void 0 ? !1 : memoryHeavy[i];
    if (typeof flag != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit, flag && bit === 1 && (heavy |= 1);
  }
  warmWasm(api, mask, heavy);
}
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData);
  return runWasm(api, text, verifyFormat, dataKind, !1);
}
export {
  binary,
  warmup
};
