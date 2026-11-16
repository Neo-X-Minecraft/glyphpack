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
  if (text.charCodeAt(0) !== 9) throw failure(9);
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
var api = await loadWasm("H4sIAAAAAAACA7VWO48cRRCuru6emZ3egQ0ILB9CPRORIAdIDuzA2ydhczqdzhKIgMQ+4RNi9s738PqwhfGuLQcXWOCAwCAHyAmRJURCREJKQsQP8B8wJMgSnI+vemb2HsISCVqtpvpV9dXX9WhaubauiEidtJdJTS7ryWSCD9FlJV+Wke5lipXGLmO1IpNeTJP11fWN7ZtMyZXVjzaurBL3Prm6eX18aXO8TTrfuD7uBsZtrtxc21i5cmlt9SrZ/Np4Y3u1GSTJpyvb69c3Kc1/ei37ETY+sxPPe4O9PgARkyZDlhJKae8LVWrPXgU1rpLAo6B2gqqrNDzf399PtypTl8qTN7Ke1aX1pmQ9xIzec4o8hUFdyqCf0dFfqzlko4oLct749IIZ+sRno5KgwXp1FgpgWCzYwKKcgKAibHdeuasUdqfmTaZ3zFCk8P20f5rJhW+n5i2Ks4//duGFCnefu/Alh8dTF349G/6c2vDbMw5P75qwey48umPCzxSeQsHrQQ3o8O+k6ArqDMHi7oDziboduDQ8DA+i5QqAFgoKvdKEaTOTnVIYX8AkNg7ATVCjqhe3eawxiDqlHk9NJQsly5yQ97bMlQVPcODOlJdBBQ6dL9gXsiXptsx//UzfvjX/zTP9eVkE3VcOGzjkO0/aFSXz7MBZEUzwgYTjnaC3BOv5OcFzfq6yT94DnmKe4sf3vMLNjp98UBAPffFdlYevojtLIPFelEqCrZDB0d3O9RuLhfiX1uGGaJ/4HC59vBNEMX84J3Gife71XJWKRAvYrsHTrcUo7O/rOgx2KneOqmQRDjufjIbQA6+dWPWE6xRzXosARD6NF0ylDg8xymX6kQjejkSWUCwuzpUOTu+rrXDn7r1srezzULyaH7xfSEBl2763KLcRo7ouU+hL8Df4s2zlIeJP+d4CnIcpYQe+CMIUYSj3294hxubwOOAK1uqAyxmV2kUXJUkkAbwZ+2S7THgCKAaxCeJ+/+HpXwm4gBHC3wbTZ0mEbmUkB8GmGe3ERdx1Ek6InOKAdqVBZroaOdO/dpoo4mTBGVGzR25ynNQt+OQY+Oy/gAf7nsbeRvCeBDnSvUNoIkI6QGjCH7LUcGdatw4jN4JcH0WuwKPvLRdaqMCSrlvabYs8P4a8/zLkqCTUIWdBGpFbIDdQBMJmyLHacmsahHwYOUf0cd4KcgPkHIQXwW1nuJOIWyC9cgziAFXy30FWtkOYwNOq1chjb7YrM9OMakqAzYDNYO+AcCs5DdhJR+wxwpPuIk7InoZwYVSq+KCW2EchRX1gGeVLBfetc47iD7eJqJGyMuMACr2KvMaMkAIy9lktBTlFnnAp8StxRl2SHOWBX3ZVHLO0IcJKuMYMyeSqJD9s4/LSgV8xTCorSSISDmUzH2OUN7fYXGriTacistacdVJxQTHMSIvJoR2ZDv4zId1GzzGRL5tJTHrbrp6hphVV2lU4JjzYuIDaKmtW2hRozmMKVnYpntc4324b7DQqdKdiGRWoXTvRrpmoQmpKmUqrqyuhXLqdMIDIi4ckXOAF6qoE0gCdgiVCOEZFrPMwIRtjqpZK7iiQWGABGXv5qFKxiUoPCilMHN6Eet5KyUyyM8nMJD2TuD4w0ElZXSGPL0QzGp4SGne4tRVnESUwiGRHzY4RhxzghRaRRjS4xiVvQUEkKuCpoeOpo75o8UXHk/Z/9oWiL8gr94tSyaRrg+ro60M+pRL8qC7vFhQbOt5GHO7PGmrzUoiR1vRQ1fZQhR7K0kMrLa8sKYRzlRbjSnond72Tw4u2dxr0TrsYK5s96J0w4FXXO1mE+20TxbMJ+fKg7a0oHq5HbYMX6dFMethIb8gTTklL6b0KuPjm+CKyBlIhnCuQ2rDmrJFX6j9h4k5y1QoAAA==");
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
