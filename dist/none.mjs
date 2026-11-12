// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function failure(status) {
  return status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
    status === 2 ? "Invalid payload length" : status === 9 ? "Unsupported payload codec" : status === 10 ? "Unsupported memory optimization option" : "Wasm decoder failure"
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
var api = await loadWasm("H4sIAAAAAAACA7VWv28cRRR+82t3b+fucgVFFCM0uxUNSoGUIiniF4kEK7KMBKKgSSxiIfbs2L5cjkSE7CVKkQIBBUWIUqA0VJEQDT0tBVT8AfkHAg2KBI753uze+RzJUhp0Ou3sm5n3vve9X0vr17YUEakT7jKp+rKp6xoPostKnlreTCdTWhmcss4osul7abK1sbU9uqkpubLx8faVDdKdT6/uXB9f2hmPyOTb18ezF+t31m9ubq9fubS5cZVcfm28PdpoXpLks/XR1vUdSvPfXst+ho3PXR303mCvC0CkyZAlRwmltPeVKkzQQbEalwnrIasJq6pM+fn+/n66W9qqUIGClf2sKlywhTbLkJg9rygQD6pCXroZHf61mjkblrpHPtiQXrDLIQnZsCBocEGdgQIYFguOtSgnICgJx31Q/irx/al9U9M7dllW/OO0e0qT5++n9i2K0sf/en6h+O5zz19rfjz1/PsZ/nvq+I9nmp/etXz/LD+6Y/kX4qdQ8DqrAS3+ToguVqcJFh8OtK/VbdaF0cv8TbRcZqxXesQdkcmPp43cn1SQDvsW4TPkB6qrvNwcqJCxGjb3VPDiFpyJx9X4pHo8tSVcBgUi05C9LbKir2tQcWeq1+AV9ECLPt/ToS/H7OzYue+emdu3zj18Zr4o+mxgEweI88mTdkeJXPtCRR19thxYgpRN2OyWGjqXEBJ1fql0T97vUeifo/gIWVAI/fjJhz3Sy6H/Q5nzt9HTVeC5F1dFR3zMCtNGBepuXISPmtOKb+yWHa5DDtc+mbAo1h8tSSLpkAe9hDTCqrMSj0+nt5p7+/um4sGkTM5SmV6MyZEOl4lreO7Faugg3mIuaFkAUbAxA6iw/ABvuYgfySK4IdZwdV/t8p2797LNoicBA5LBBz3Js2wUsotY+ZjsVZFCi8HfNZFFSiJ2K3CXikT4AHrBlC6ELqSI58I7g/XNihGPYZH4kMAjKRoENwlmHLqjwuoaGAxyFdD+/OnpPwlchwXCX7Ptah/MfEeyIgF5ZjiJmwiv5eOyTnHBeITUhU6FUupdO0UUQWoBGSFjU0pIhKZBzrY6DD55FfAW4Gkc9Ag5XweSsEgONZhgR5pBi7dB+Je8CHHYjW6RyE2D3ECWeiiNyE2LXAFayNZ6wj9hK6lazl2LPHsJeX4UcnQWmiF3gi0i10BuoQhm59xKd8E+/DANt+4AObIgZkOUa0FuwLkD5yADuPUcdxJxC6TuSxD7R0As9QKzVdnqc+NgRuUBH+itBNDOSmecExw7KAgC6O4sIRZAC32tPNLdBWgTQUsmKPRmSXkHcOjSaaDYaCHMV3u667z3FH8IMNq8qJkREVQkNtZDEIalYBIjNtPgoCYTWYxVsshCcnR9pB4wWiJ0SNv68PA5VoduXF498CsmSamlRGSFS37uY8xxcTtty6UbzExFZK2568GCB8VFiiJEJ4J2FDn4T4V0HV2GIF+zdax31+6epmYwldZLAxMSdNxAI5U9LUPLenQdKcBSr8b7BvfbY4NJo8LMVKyh8bR7x9s9G1VE6hMZfFUpfMfZZwUSiDjmYzDQB8X9HMlbWh5gK7ojmYGBjcZOVenEghQrgmyETpoDjdN9WKqoGrEZcgozi4fQwNtVMl+5+crOV2a+0tWBgdkqkx7vLkQzyGG0jJL41m6UIlNk5jNJk3YSHHC10iIyKA3fuBSwQ+KKZXx8uHjrsC9OfHENTf+zLxR9QW35X5VK6tncU4e/R+RRKMGP/vJuT6pYCgBl/+V8gjZfDTHbmqGp2qGpMDS1DM3SyHcXCDBLpRHj6qVh+aIdlhbDUuiU3nYwLGEgqEPDEsaDEbaVRwvG50wQ7pFwvkPtRJfVo/nqQbN6Q4aokqHSOQa4eOZ4IrMG0h6876G8Yc07K9+t/wH3thuY5woAAA==");
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
  return runWasm(api, text, !1, 0, !1);
}
export {
  binary,
  warmup
};
