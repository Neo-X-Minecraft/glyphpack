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
var api = await loadWasm("H4sIAAAAAAACA7VWvYsdVRQ/92s+3n2TvMIiZEXuTGUjKYQUSZE9AROXsKygWNgki1nEebvZ3ZeXZ4Ix7yWkSCFqYRElhQTBKiA29rY2VoJt/oFoIwHdrL9zZ97s20jARoZhzj333nN+53to/eqWIiJ13F0iNb1kptMpPkSXlHy1rEyeKa0MTllnFNn0rTTZ2tjaHt3QlFzeeH/78gbp/MMrO9fGF3fGIzK97Wvj+cL6nfUbm9vrly9ublwh17s63h5tNIsk+Wh9tHVth9Leby9lP0LHx24a9N5grw9ApMmQJUcJpbT3mSpN0EGxGlcJ6yGrCau6Svnp/v5+ulvZulSBgpX9rC5dsKU2y+CYPa8oEA/qUhb9jA4/rWTOhpUuyAcb0vN2OSQhG5YECS6o0xAAxaLBsRbhBAQV4bgPyl8hvjezr2p6wy4Lxd/P+ic1ef5mZl+jyH34t+dniu889fy55oczz7+c5j9njn99ovnxHcv3zvCD25Z/In4MAS+zGtDic1xksTpF0PjtQPem6hbr0uhl/iJqrjLWKwVxLjx5eNbw8xMK3OGRRBlj4E8/UH3l5e5AhYzVsLmpQi6G5T7EC2p8Qj2c2QpGwwnC0+C9Lryy0FM44/ZMr8EuyIEUfa7QoZBjdn7s7FdPzK2bZ79+Yj4pCzbQiQPEvcmjdkcJX/tSRRkFWw4sYcombHYrDZlLCIo6t1S5R28XFIqzFD8hCwrBHz96tyC9HIrvKs9fRltXgedupMqe2JiVpo0LxF2/ABs1pzVf3616PA0epn0wYRGs31uSVNLBB72ERALVW4nHZ7Obzb39fVPzYFIlZ6hKL8T0SIfLxFNY7kVr6CHioi5oIYAo2JgDVFq+j5UX9gMhghuChqn7apdv37mbbZZ9CRmQDN4pJNOyUcgugMpjutelhpQUr8HrmvgiMRG/FZhMZSI+gQWCSy+ED7h1vbBmeH6zZsRkWCY+JLBKSgcBToIZh3RUpnoKHAYZC3i///D4rwTmQwNFM2xf+2C6HcmMBA40w0ncRIhTPiZ0igvGI6wu9OqQhv7Vk0QRpBaQETI2pZCEaRrkbOvD4JP/At4API2DjeADSWgkjxpM0AN8c7yC0PAfshDHYTeaRQvIDXjpv5ArQAvZWiH+J2wldetz1yLPnkPeexFy9BeaI3eCLSK3QG4gCGo730qPaXxrGt+6A+TIgpgNkW8FuYHPHXwOZwC37XAnEbdA6j8H8cgLIFZ2ji+FnVUrz42DGVWmk4sOSwDtrPTHtANtgAYOAuh0nhALoE1MY9uE4ZicScET0JIJCh1a0t4BHHq1DhTbLZh+tdB9572n+CDAaPYipnME5AYVnRtrAoVDsXASI3p1cBCVCS/GK1n0RPLiGkG264Ng6bZGcgmWVEgbq9UD22KiVFrKRCgozjs7Y56L6boNa3oo3Ka966Eph5uhBokF060UOmKQi+N1NBstRAW/Zqex6l27f4qaIVVZX+mYlpGNhio7WsaXlas+lmGlV+N9U7v5wcGkEWEaEatoQO3OsXbHRhHR/YmMwLoSf8cpaAUQHHFUgoI0wMVSGqodVoghtqI5YjtGNxo8QckaNEjBItBGqog6oHHODysVRSM2Q06hZvEQGnlLJR3lOsp2lOkoXR8omFOZ9Hp7vrUAJYehzjd3IxcuhELkszRrK8FB2ay0iAwywjcmoY9VJKY4lt+QeOuwLVZssfGm+59toWgL6sv/rFQync8/dfjPRD6lEvzoMW8WUslSABiTn3aTtPl/kGxTzfBU7fBUGJ5ahmdl5A9M6mKpMqJcPTc0n7VD02JoOslIuPhgaEJBUIeGJpQHI95WHm0YPzZBfI+E8zm1k12oBx11v6FekWGqZLDkRwEX3x6+yKyBtAjvC5Q3tHln5Q/2HxxKqJPxCgAA");
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
  return runWasm(api, text, !1, 0, !1);
}
export {
  binary,
  warmup
};
