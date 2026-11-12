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
  if (!(first === 9 || first >= 32 || first === 10 || first === 12))
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
    throw status === 9 ? Error("Unsupported payload codec") : status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 6 ? "Payload checksum mismatch" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure");
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

// memory-options.js
function selectMemory(value = !1) {
  if (value !== !0 && value !== !1) throw Error("Unsupported memory optimization option");
  return value;
}

// options.js
function selectFormat(value = !0) {
  if (value !== !0 && value !== !1) throw Error("Unsupported format verification option");
  return value;
}
function selectData(value = "secure") {
  if (value === "secure" || value === !0) return 2;
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
    switch (codecs[i]) {
      case "pair":
        bit = 1;
        break;
      case "ans":
        bit = 2;
        break;
      case "windows":
        bit = 4;
        break;
      default:
        throw Error("Unsupported payload codec");
    }
    let flag = memoryHeavy === void 0 ? !1 : memoryHeavy[i];
    if (typeof flag != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit, flag && bit === 1 && (heavy |= 1);
  }
  warmWasm(api, mask, heavy);
}
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData), memoryHeavy = selectMemory(options.memoryHeavy);
  return runWasm(api, text, verifyFormat, dataKind, memoryHeavy);
}
export {
  binary,
  warmup
};
