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
var api = await loadWasm("H4sIAAAAAAACA7VWPY8cRRCt/pqZnd5ZHxISli6gZyIS5ADJgUHi2pIPTifLSCACEvuET4iZO9/ter3YkvGukQMHDggIDHKASCCxZPELnBAi8Rv4AzYRgWWWVzWz6/WXRGB02uuaqu7qV6+rupp2Lu4rIlJv2HOkpufMdDrFoPifZtGkidKYYJxRZNOP0mR/d/9gdEVTcn7384Pzu0S9Ly8cXhqfPRyPSOUHl8aLD+0Pd67sHeycP7u3e4FMfnF8MNptP2zy1c5o/9Ihufzv15P7r2k/VdeiLrXeiN/O7FuaqjTqrYJij3XQzlpt75iCrhlY0korH3pR12UvpFE1ZerjzXaWOWU3WI73Zv3jmngojY8/zuzbRGwLpTbwGnRFUdW8RaA4e2iGcXbPbBaEr/faYU5NLLdE/OORaeKbp0X+5T70utXPH3dL1DhYuKvsu+qnmYXi8dxsFboPnDr+MzcfFMoLiqhOEHmON7RhBolLjY/xQsbUlJZ1Grp3WFcO9BQOr8/0GbvBizYLHQY8xS6mnPz+gbl29eQPD8zX5SAa3nUAPPnkbmdRrNe+VGEQbQyRYM0m0Qyxod5c5wA216vk7sfAMzhJMoQ0qAY73P20IJA0+LnK43dC8mnQeEOk0mOvmCEYEy9vFwpDWsfLw8rHacgRyxeTyB71Z+vMDoU80Hpl6hKcBRCkmPvZ1W0R5nNTx7VJ5d6nKttGrC5kzQbFKQL2vGHwfKI3mV8WACYYCD5S6eJtfOWsvsNCSBrIiHKuhvH6NzeyvbLPyQQsa58gOhWzUUi3mX7IalyXBl4y/DR+lqfqDbMRVEi3EC2VCdOBGBiXWTkxRKzrle8IwvfqiKNoysSHBFHN5+kQASdBj0M2KjM95fRDLiLmh7/++ShB+NiBJAzb10iZpaXhhaBQNxMx4mSzeJTlFAuMB/OgpQ5Z6F88TiQgNYMUyDDWyCZWmhZ5tPXT4JP/Al4DPI2DE/CB4IgxUYsJ+wDfAm+b8X/xBxMHq4RFK8gNdOlzyBWghfRMweeAgwtJ3XHuOuTZM8jzlyEnL8kkyC1jE+QOyDUcYdslt1yoLbe65dY+QY4skGwQvWPkGpxbcA4ygNstcSeCWxA74Oo/g3PwEpzVEiQTaMdBj8oCIC1AwtkSpBaQFiCzFkyyClJL2oq+YJAZQGoG6RhkPxQdyIxrznE2qLhWc+oz1jXkfSBcC5aV+WncWM57T/KHqJE+jit8QQb2CkoIlrpA8ZAUT4JSsSVnscGZUVcnySoRycvrBGjNgoteMF2dMBdSJb2WCtw6kiSVETCoVS4V1mBTTnDEtqCA6TDd0WbLVTj73oJWzj9mp+yhGA1CZ+9MWY/5MhI2FPkZO5W6d531hLCJu8z5CsuYBCMG3KdsM9xUnMcNxIXIU1oPBh66iWuT1olpnXBX6SxHO4sVFwmPifAJT4TLyvOxwiEO/ggfipZTRvh5cE3l4hpMaJjw18jdHrAFUrDtW6qRysVpGy4nWqJl9lRTKfYfU7SkVTuu805KlpJbSnYpmaWk6ye+W8lK9VZoghyBxZ/D5YH8vzqEFhRy9kRqL2wrkLdkKm64IZiQE3LcPiQUx6HgAhxWVpY+HYvlWOz/FgutxoKrzv+uVDJdvD7UC14fyssTgz6UNsoFUOl4a9lI29dNqSTfpImidWpunZWZYFskrUHLhK3trEg9HRS3Tr1onfLCkNZp0Trdtlwg7knrxBZBLVqnZuHWonWimhN+dklHRcr5HnWtnaU7S+l2K/2mlOLHiOIO0zuC5RjzIxLhqYI6Gp4mYfH4gjlw7mGuat9e6pW9vTRXpH7+7aVe9PbCwRWK3x3WO4v3rf0XE1/yKgoLAAA=");
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
function binary(text) {
  return runWasm(api, text, !1, 0, !1);
}
export {
  binary,
  warmup
};
