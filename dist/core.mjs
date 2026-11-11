// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
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
var api = await loadWasm("H4sIAAAAAAACA7VWv28cVRCe92t3797d4YgmkgvebkWDUiClSJDws4SDZVkuQBQ0iYUtxK4d++zLKZFM7oJSpEhBQRFQCkQDjSWLvyD/ABJ/A/9AQh2F45vZvfUlYIkGWeedndmd933fm3mztH28r4hIXTK3SE1umclkgovCP5M4pRFyRpFNbyTJ/u7+wdE9TcnO7hcHO7tEna9uH94Z3TwcHZHqHtwZzW+0P9y+t3ewvXNzb/c2me7x6OBot76x3bO33bNL2k/U/ahzrVfit1P7rqYijXq9T7HDPnintbdzRcFXDSxppZUPnajLvBPSqKo89fFR/ZT5yK6wHc+mvaua+JIbH3+c2veIOBZybZA16IKiKnmJQHH6wgzj9Mys9Ql3H9SXGVUxXxfz95emiu9siv3LM/h17Z+9al5Ro2CRrrDX1U9TC8ermVnv6x5w6vjXzNzoKy8oorpG5JlvqGkG4aVGV/hFxlTlln0avvfZlw/0BAkfTPWWXeGX1vo6DPgRO39k9fvn5v7J6g/Pzdf5IBpedQA83fFpE1Hs1z5XYRBtDJEQzcbRDLGgXltmAmvLRXL6CfAMVkkuIQ2qwgqnn/UJIg1+LrrxOxF5EzI+FCv3WCtmIGPi3Y2+wiUt491h4eMkdMHly3HkjPrzZVaHQjfQcmHKHJoFCKRY++nJhhizmSnj0rhwH1KRbYCrC1m1QnECwp4XDJ539BHrywbABAPDR8pdfIK7LrufshGSCjZYztQwPvjmYbaX97iYgGXpU7BTMTsK6QbLD1uNytwgS4afxs/yo3rFrAQV0nWwpTxhOcCBcZmFHQNjXS7cRwi+V0ZsRZUnPiRgNZulQxBOgh6F7CjP9ITLD7UIzi9+/eNlAvpYgYSG7WmUTBup+EVIqKuxBLGzWbzMdooXjIfykKUMWegdXyUSkJpBCmQES1QTO02NPNrydfDJfwGvAZ5GwQn4QEjEmKjGhHWAb463rvg/+YaFQ1Ro0QJyA1/6D+QK0EK61ed9wMaFpGw0dw3y7A3k3YuQk5diEuSWsQlyB+QaibBsqy03aq2trrW158hRBVIN4neMXENzC80hBnC7FnciuAWxA67eGzgHF+AsWpAsoB0FfZT3AdICJJK1ILWAtACZ1WCSRZBaylb8fQaZAaRmkI5B9kK/AZlxzzmuBhWXSi59xrqEug+EY8Gys7uJE8t570n+wBrl47jD52JgraBEYOkLNA9J8yRoFZtzFRvsGTV9kiwKkVzcJ0Br5lp0gmn6hLWQLunUUuDUkSIpjIBBr3KrsAeLcoGD21wClsM0W5u1b2HvO3NZuf5YnbyDZjSgztlZsg7rZYQ2HN0tO5G+d030mqiJs8z5Aq+xCEYCOE85ZnioOI8TiBuRH6kzGGRoHlwa10lMnYSnShO53ESspEj4moieyEQ4rDxvKxJi49/iTdGyy6DfDa4qXFxCCAMT+So52wOWQAnWc0tV0rnYbcPtRC1aVk9VheL8McVIWozjOG+spLVca9nWMq2ly/PctWWlewsMQWZg8edweKD+T4bwQkKunkj1gW0F8ro8ihNuCCVkhxyPD6HimAoOwGFh5dXXuVjmYv83LrTIBUed/02pZDL/+lD/8vWhvHxi0McyRrkBCh0ft4O0/rrJldSbDFGMTs2jszBjLIuiNRiZiNWTFaWng+LRqeejU74wZHRajE63IQeIOx+dWCKo+ejUbDyej050c8KfXTJRUXK+Q81oZ+tpaz2pLd9XPLCtdxafg/ZvwibUKjMKAAA=");
function binary(text) {
  return runWasm(api, text, !1, 0, !1);
}
export {
  binary
};
