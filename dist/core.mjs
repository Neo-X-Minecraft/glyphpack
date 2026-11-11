// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function warmWasm(api2, codecs) {
  let status = api2.warmup(codecs);
  if (status)
    throw status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error("Unsupported payload codec");
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
    throw status === 9 ? Error("Unsupported payload codec") : status === 2 ? Error("Invalid payload length") : status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error("Wasm decoder failure");
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
var api = await loadWasm("H4sIAAAAAAACA7VWPY8cRRCt/pqZ3d5ZnyUCSxfQMxEJcoDkwCBxbckHp5NlJBABiX3CJ8TMne92b73YkvGukQMHDggIDHKASCCxZJEj+Q8g8Rv4AzaxZZZXNbPj9ZdEADrtTU11T/V7r6u6mnaO9hURqePmIqnZRTXDPzOb4WHSRMuQM4ps+lGa7O/uH4yvaUou7X5+cGmXqPfl5cMrkwuHkzGp/sGVyfJF+8Oda3sHO5cu7O1eJtM/mhyMd5sXm3y1M96/ckiu/+iN5OFx7WfqRtSF1hvx27l9S1OZRr2VU+yxD9554+2dVPDVQ0taaeVDL+qq6IU0qrpIfbzdzDJn7Qbb8cF8cEoTPwrj449z+zYRj4VCG0QNuqSoKl4iUJw/NqM4f2A2c8Lbe81jQXUstsT844mp45vnxP7lIfy68S+etp+oSbAIV9p31U9zC8fThdnK9QA4dfx7YT7IlRcUUZ0m8sw3NDSD8FKTk/whY6oLyz4N3zvsK4Z6hoA35/q83eCPNnMdhjzFLqec+f6RuXH9zA+PzNfFMBpedQg8/en9dkSxX/tChWG0MUTCaDaNZoQF9eY6E9hcL5P7HwPP8AzJI6RB1Vjh/qc5QaThz2U/ficin4OMt8QqPNaKGciYeHU7V3ikVbw6Kn2chT64fDGNHFF/ts7qUOgHWi9NVUCzAIEUaz+/vi3GYmGquDYt3ftUZtvg6kJWb1CcgbDnBYPnHb3N+rIBMMHA8JEKF+/irc/ue2yEpIYNlgs1ije/uZXtFQNOJmBZ+wTsVMzGId1m+WGrSVUYRMnw0/hZnqo3zEZQId0CWyoSlgMcGJdZ2TEw1tXKe4Tge1XEVtRF4kMCVotFOgLhJOhJyMZFpmecfshFcH78659PEtDHCiQ07EAjZbqRmj+EhLqeyiB2Nosn2E7xgfFQHrJUIQuDo1NEAlIzSIGMwQrZxE7TII+2eh588m/Aa4CnSXACPhACMSZqMGEd4FvibTL+L35h4TAqtGgFuYEvfQm5ArSQns95H7BxIalazV2LPHsBef91yMlLMglyy9gEuQNyjUBYttOWC7XRVjfa2mfIkQWSDeJ3jFxDcwvNIQZwuw53IrgFsQOuwQs4h6/BWXYgWUA7CXpc5ABpARLBOpBaQFqAzBowySpILWkr/pxBZgCpGaRjkIOQtyAzrjnH2aDiWsWpz1jXkPeBcCxYdvbP4cRy3nuSP7BG+jiu8KUYWCsoEVjqAsVDUjwJSsUWnMUGe0ZtnSSrQiSvrxOgNUstesG0dcJaSJX0Gilw6kiSlEbAoFa5VNiDRTnBwW0pActh2q3Nuq+w972lrJx/rE7RQzEaUOfoLFmP9TJCG47+eTuTunft6GlRE2eZ8yU+YxGMDOA85THDTcV5nEBciDyliWAQoZ24Nm2CmCYId5V25EQ7YiVEws9E9EQkwmHleVsREBt/jDdFyy6Dfj+4unRxDUNomIhXy9kesARSsOlbqpbKxW4bLifq0LJ6qi4Vx48pWtLqOI7z1ko6y3WW7SzTWbp6FruxrFRviSbIDCz+HA4P5P/1EbyQkLMnUnNgW4G8JVNxwo2ghOyQ4/YhVBxTwQE4Kq18+jwXy1zs/8aFVrngqPO/K5XMlrcP9Yrbh/JyxaAPpY1yAZQ63ukaaXO7KZTkmzRRtE7NrbM0UyyLpDVomRhrOitSTwfFrVMvW6fcMKR1WrROty0HiHvWOrFEUMvWqdm4s2ydqOaEr13SUZFyvkdta2frXmfdbazflJLLiOIO0zsmzM7m1NJ/nvzy0oXhwDmHuaq5c6n/7M6luRL1y3cu9ao7FzYsV3zfsN5Z3GvtPxO6VeH8CgAA");
function warmup() {
  warmWasm(api, 1);
}
function binary(text) {
  return runWasm(api, text, !1, 0, !1);
}
export {
  binary,
  warmup
};
