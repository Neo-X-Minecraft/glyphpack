// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function failure(status) {
  return status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
    status === 2 ? "Invalid payload length" : status === 9 ? "Unsupported payload codec" : status === 10 ? "Unsupported memory optimization option" : status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 6 ? "Payload checksum mismatch" : "Wasm decoder failure"
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
var api = await loadWasm("H4sIAAAAAAACA7VYy48cxR2uV7+7Z2e9lmLhhFR3OPgQ2wckH+DA1kq2Y61WRgoRUi6wgRUws37s7DCLFePZBQ4+AMnBkUgUoZBLcrEsuESKlBxyDAeQoiBFSjjkHzAkB5ASe/N9VT2zMzYo5BCP7a5X/+r7vb76VYv17QtSCCG/GT8t5PhpPR6P8RDiacmnGrf/C51nUkmNpSaKtBQmTrHC7e6aInk8iS9sXLg0uKJE/OzGM5ee3RAqe+Hi5ReHT10eDvDqpReHk44pLq9f2by0/uxTmxsXRZRvDy8NNkInjnfWBxdevCyS/INj2W+w3Q+jsVV3undKABRKaGFEJGKRiDtvylpbZaWTwyZ2qu/kyMlek7jP9/f3k63G9GpphTWcT3t1ZE2t9DJG9J1CCitct1ezU6Zi/tdKdmm/UZUorLHJWbNsY5v2awEJkZWPQgA25g6RUxQugKARWF5YWVwU7rU9c0yJ02aZLfeLvfKUEoX7+Z45Lvzo23cKd1e6u58X7kfKvb1XuA8fdf/Yi9xHt5X7+FXjrj/m3nrFuD8I9zEEfN3Jrpj9PUBZTj4isOM7teqO1bVvQaV+c+ghQKmVWg4/97oH0gDmuUq4LMy4f+/6UXNSYqzfiYVSCtaGslTHQCvZr6OiCwsCLORZLwAL+AxDJZdTgByelG/vmTpmV026jb65sr+vX60Pq2sBi6XmNqboBI+9XXW+kqUunIT8+HRlrEbfFJP9zlTaaTQPUy79+DDlrvz0tr52deVnt/XLpSrmxEFDNHavq1UgxJuUPZWl/DazkpqlxzHKHZa8UHv4arO08ts/74snKo75LWQQcdgmLh/dbDeXLxf1kjO1npjZq5e4dOT0VkNIHdgTsSOwgag1lbK1Rv90RbtxDEj12co7i3pEliG8dbodkZOR4U279MSBwZdWxHcPehqT35t2AUGepgkQm+LsGUiKJuNLv2oq92MfCmtYv+tbdUEoY1sB73MjJyBcff8okyi2lY2PNt06VsttKDeFe2kVwguX9NxLWw0s32tyW9DmOUjgKiaxUe7g857rjpr0MdHEa5hNbdxfFm4MZbkfxNkc2QB3ZIU9ZItTyuCRYcgeOsbxLSZIGsyCEVMXhG67fAnI+QZy6QZaFYfeYsPqPtpq7GMMD0YjrVB3YWvj7Z24fbnl9l55Ld2sF7zDoiZhng+oQ+W6PnwsA7hXZ2oZqa5swmAXSHCulD0Els1mYt5myJeZvkN8bPYcIofpg8Db92QEoolsObSdQZ2rMXYumQnCffLe3/8Vr1YAWgtidIY6l9OZPl+EY8r+yE/C5bk7wnaCF3RRp2Cnomdzu7B9SggPUhGkh2wseC/3gzogd6Y3Dz7+KuBTgBdDqwe1oYEhiJhEwETus+kELxGm7lN2aDjMerWE54qAXGMsKepFgAZy0yJXgGaT81VJU2C/fII8apGn9yDPvww5s26C3ADbokeeAvkiBC0CxsS2hhmMxVjTHwWEU+QizHrkMLYBbA3NjowKKOyRp1Pk8QxyfYA8aZGX9yDvfBXkKY+uoY0G4BhEMwSZAyvXpUdt4IFOiIp0FjmRtOOaNu9AgRLREnDrKe6UB2BOulc4DG2yWmnAw7GYWUGq5GC1VpFGi6LMGHs4VDXlKg/WZwdSRoSUQcLgjKXpoL/4H7PF0PxT5U2bLTGU97nS6g7y8qHSRD6pO/APEoYjcAvDHHvHrc7BoyF5OtO3kF1TOxYwZAxzkOYQc5WXThvFNFDUqmqr82bssz9qZx/x5gNP6qLBazRC5CdwAHAuYmkAe1c+HZtozb+v8X67rDsKIvRExPlKTOaOtHPGi2DK0h+UQ3uzwgDYLnne+PdcOFDgV/YewBNiyIfd1AkyfGBDWCsPuVibFVEvfREdBjL0MZTRxeGk8s0DfgzO7iBEjOdIFAt8ReIQxsnas9F5HOSdGS83KY/2zrzrG8FBRPlMDDTpAV2mNhvafFAnni6zL6TLMtBlNkeXUNpm8HgZEiBhMJQTusyDdZI2BSJf7qxO0WuPPgLWOZ5sYG0OzpEltYom6d7Ftl+kR0INh7YMWUzmhA+nYDMPVsyCncnirNVwksVUIrsviw15E6CLVoVoqsIcYTY6qJDf6wPPtItWzzsimSiAU5OOgAI8WzPmM9BMFCD9l0DtLR6AzijgZycESt4na5FAu7awiz2YYqJCPKdCMlWhvN/gnXn6DCrcE0b5AY+U2AiHPAy2ALvpoe0OmrLdlfQHpTSU0jPcmoHmkE3wSr5iWOXdx6+ZH2c++bmS3snpnRWNcXgoQeoG+ozIqR1yqk8YGGiOU1P6HAluSKbRLJl2NIKS5y5Saq3SD3jbdO4JSnVfVqUc1Kh97olIfWAS3WZWSYfOUyv1AgOBKBNPFHmgV474EltTr6CuVzUJPg8Jl8+9bbNZms3gCNBsCpphOie2WvW6VrhSsILv+W38qerLmNocDJANuaQxBTzpydY7NG3JNiHZGpJtTJJMSLaxJ9t2WSBbDrUiSLbt3JF2LviAeU9HBbKNPNmitk7IrSQ/3CTO2eomyu6X7RLvCuLJLRCwwYq8Yvmsn+R5g2rb6eHoaEWSSlqaDoVahUO7S68XBS+XbcXO+p1lLMtsYrHVWdoFVoI3oVffmbMVGATieLyypjKesXGSMCTf/eAv78la0hux+yQ4OnIfvP7LN2P48dfX33hHwfFxLd1nN27degmkuuypWzq9ho2kM322DFrptFX6lvJHXiOOCRFe3kRR6aod9+4///bplU3WKQA8M5vMziaQ0+3zHo5sm1lkZhehSEOmz8zq2VnexG3PVyi8Ja75G7krdxB3h3ZA5S7ZoSPlDi7jCBp/4lkYD91gIpzGZnDeh1vU958AFBWjXNPn5RD6cfPf/fWPP7m6aWXPLe64Wx/96fdq01/v0x4lsL4Im+OJI6jw52V8pj23CQ3ieftLjb85NMxcDAtc+IODvOxiqpgkapwV/ptBRCfzCuWD3n9mYHUw8y4ribmunOt+yS7/tQkYvjIC0LPh64VbGFm53foCWlQjK7Zb66DbZRfsJfzPw4X1eNmM6/Zqy2sb3PUQEmahXfe+lPF4cpOU859F+Ki9QZEv36n8JY4fbZS7Pr2whu8V3rW8hjJmwzVUOl+a9Z9rND//IFr10UZTH0luUeFmysbd9l5qcC+NVn1BHfl76ZlKFdzASoLh9VSxgc2t5qVUFqieXkdP8N5p4yIT7QWarbemrRuh9SC/LUkWFdkC4OKZ44mzv0vjFJ8pqcdMC4QkVfaVvPCRQ9hkCn8i1UZ7g5CffCj5T1n9xngvaTQdq8HZRbBI24qnrWjaMtOWnrZU72CDSSsl96kQDLAiTkIY+eqWH10Nse1oiWncnGvjRm+1XsSPtTFVgZu2GuXfmteFPvOf1/jm/1cX7XUpijckvx/smuLKM4P14cb2yfChcnB8Z337wsntwTMnT5xo/7Lz/Pr28ycG2+LLFm++8ANOHxdSPCiEeF8K8bDgHym+jf+RkOJrM/0K/74hGGdFZPgN9T97IeDSeBUAAA==");
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
function binary(text, options = {}) {
  let verifyFormat = selectFormat(options.verifyFormat), dataKind = selectData(options.verifyData);
  if (text.length < 2) throw failure(2);
  if (text.charCodeAt(0) === 11) throw failure(9);
  if (text.charCodeAt(0) === 14) throw failure(9);
  return runWasm(api, text, verifyFormat, dataKind, !1);
}
export {
  binary,
  warmup
};
