// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  let length = text.length, pointer = api2.input_ptr(length);
  if (pointer === 0 && length) throw RangeError("Wasm decoder memory allocation failed");
  if (littleEndian) {
    let input = new Uint16Array(api2.memory.buffer, pointer, length);
    for (let i = 0; i < length; i++) input[i] = text.charCodeAt(i);
  } else {
    let input = new DataView(api2.memory.buffer, pointer, length * 2);
    for (let i = 0; i < length; i++) input.setUint16(i * 2, text.charCodeAt(i), !0);
  }
  let status = api2.decode(+verifyFormat, dataKind, +memoryHeavy);
  if (status)
    throw status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error("Wasm decoder failure");
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
var api = await loadWasm("H4sIAAAAAAACA7VWP28cRRR/82937+b2bKgiuWB2KxqUAikFQeLmpNhYluUCiTaJiIXYdeKcfbESycldSIRSpKCgCCgFoglNpIhPwEego+cLJDQ0UTh+7+16fQmKRIOs876ZN/Pe7/0funx4VRGResdcIjW7ZGazGT4K/0zilAbLGUU23UiSq7tX9w9uaUqu7H6xf2WXqPfVtes3phevTw9I9fdvTE8W2l+/fGtv//KVi3u718j0D6f7B7vNwvZfvOv+WtF+pu9EXTg9it/O7fuayt6FnEIvqvWc4rzZ6p9VFNX0rPppbkt6Ol4szL2xul2sBHA0OB8ypxjqWaB4d6537AgS9Hquw5CP2JMj4++fmzvH4x+em9vFMJqB8mFl3H8AgQt1T5hheMySh1H7QoVhtDFECitPSh2zo2gmJUHuGtSo9bXSPP0MWIdjkk/oBVU/HatvPs9Jj8LwSZnF78SAbTuK94UqPHTGrHDxQWMaxZtbuYK8tIo3J6WPs5BFVX95BK1Z1DtrUVUlyEBrpa0KChT8plyYz4+bm/BGFVePyuQTKtMtmJ6EtB5RnMF+z3qDP6eJFQZiApiCBeEjFTY+wirj7cdMBFODDjou1CTe/fp+tlcM9AjWqJgdhN5WzqhWN/HpY0tNq0JDSoqfw8/wUT0yOB56mzCaioS9AhsYl14KI1Toamkd4fy9KiIydZH4kMCqxSKdwOAkuGlID4pUz4DDXYAgii9++eNlAvOhgcQMO9A+uI5T80W40NVHwkSg03iG6RQXjC9cMMFXIQ2Dw3NEAlIzSIFsgqsKI5umQR5t9Tr45L+AdwBP02AFfCAODTBRgwl6gO8ELyN08U9esOPAFbNoCbnBXvov5ArQQm8nN+wKsJKq9blrkWdvIO+/DTl5SSZBbhibILdA7iAIajvfgtv61jW+NafIkQWSDbJvGbmDzw18DmcAt+1wJ4LbMmLGNXgD5/AtOMsOJDvQTIM7KHKANAAJ8zuQTkAagEwbMMkySCdpK/s5g0wB0jFIyyAHIW9BZlxzlrNBxdWKK8AB2yryPhAahOHNbDvXA+e9J/mD1bjAojtnQFdQ4mCpCxQPSfEkKBVTcBZrxIzaOkmWHZG8vU6Q8fo0YLqtkz4HjKukjdf2qb2SLKXmUmEKSvud7ZLr7A7dhjZ9LeSuveuhqY8QQg2SC6ZbLna4rM/+0mI2NrIdO5O6dy33I/Emepn1Ja6xE7Qw0FaZhy4On3l0IC5EPtJIMJDQHlw9aoSYRsg2mlDLOdNyrIhI+JuIPyGJ0LM8R8IhtNkOLnGEYXoWbF3auIphgeEDWbW094A7cCZLh9NrqVpE2nApUYdUszF1qUR2in64zEcrb6mko1xH2Y4yHaWrU9kNZaRyS73BGrAygE2c+8cT7MJ9nDmR+zk+ViBvylF0twm8INGxPDrEFMumoPlNSiNXX7fFsC3mf7OFlm1Bm/O/a5XM4o9z+wERMpVHU3w2H/AUCoUxPG9MydnCEwWenr8wkzh/ZvAkwOrj5rOgOhabQv720tTxvW2hf/4V+7rZX7xqr6ipwCn1eakpFV8tzCaKVlrX3wuzkSvYDkBRAbBvRhn3j09llHP14QHwsBvmzbukUFzj7SBXzSBX7SBXGOSaB3lpj6CZgyEDHIkTNB/UJwNcMwAZ4A4DPNmSXpucDvA5Az4Z4JqJhycDHD3F8LNJ5jpM8T1q3xlMPe6oRw3lcyVPKu8snnP2H8+N+1LzCQAA");
function binary(text) {
  return runWasm(api, text, !1, 0, !1);
}
export {
  binary
};
