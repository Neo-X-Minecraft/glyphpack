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
var api = await loadWasm("H4sIAAAAAAACAzSHpWFDQQCG/2OorepUneAxM4O6saIyWzjmA4RzSwCQPxGAuIA55x4CAvI0fR4zmlDCAHDBCLj6V7JN2346KWSSxn2SgpqyG9bFH5YJzPbr8h3+M4Rn04eJ36QdhJ2XfkrfI+UeTu06QNnrr77ca61qYGluGCzL9u7e+Ta5LpzI24SZ+RRm5n4Ce6Gf+X8QZmbmJtxXKcNV+nn9hJkukmd3H4RpjmSLPn2WVyc5Nvgpwp+GPw0EECBYcOAhgxx+utNES0iGzcoqYxyzWc2mrnL+djKZ5MsqV0dDQE71RR09uYh2RED2p2CAgId11MWggMWvJjIX4wpLCOQoP9GNKKNiHEEieDKHG9DEmsEzanAQBBWIeSATrga+edrtgnC8G6nEr08PDkII/PS02xPS7rM/Bv7Z8Oy3ge9CfnY68IeH89fTnj/6BHlu1vHNR/PjM47fAp6TANuzGcLC17Yai81hIBlvHmJ/ymxmjA5HfHfKXAHjySVwLzqeTjtVsbeR9YklqOHQELAZV71kRqJDIWpv8+y0q1QRUfeUvP11L5Y4RcAz03imUCFOJ5RIpZpkrckxj3xiN2885tFP7KZYsh2YIAbI/dWvNBqj+xiioZIdE4NyvJrtMsV6wnaK54TtKv/KuYKnPAbSD/XIjCXDKxeUgCMqX6r6fH8q53Qh8fokRZBcXEThrC197aml1pfXvFajT1FfSrpsNWtgvGQ77RNLfbLbVblKcLKYW+Fp46lJmExszcPVVTgaquxUKThQNh5JHKk6aFYCOU5NR1YERUR5OmCIlh+WVV+3H1eB/FhlQ5L7rO1iIOSJWcYzs9cXV8YBjrSqY4bnldpQxXLqnaqnkbq6jrnEy+Tj5IM40pcdkaHeyW6kqaiXulAR5oy1nm9zhrJ2C9csR3BlzXI442iDlpguiV4AcispWx4znBIoTnqTgD99c+6HTLiQJCAfz26AgVynGasjA7nx6qQ0QhBvrXIuDjZER0ihpowGKw4CSDhRcSbUSK6OmDZtAz5bAr74K+AdWYKV5BN4AkVOrkPoEkLoEIrqM1Ul7hKlS5E7RW4XIzfCI/XOLK1SISpbN7T7Bnl/CfLB7yGHQNAiR0WakHtB7iSQI2yRq7bh1iWEhAuRI0O77xW5E+TIyovi9h3uLOFWSFssgTisq/y3QVa+RZhJpVUTEVeSW165LnJRRxDYKLCRsgWEewZCgZ01xC4lvNl3CjtrCFdGkYyA0t73BNEQ6qp/eokDH0KA9CLLTrgXf+WgDUgm8ZpuBGlFVNT6QM6tYIuGIfUZtJdkMQ/4e0eFgbAlwhM2N6SQmtP98JxK1idQB0PAVV4viUriVHQ1pi5Pp9gcakbKVMda4xv0iSsUSxrJINVLIqP8F0q6T5XLRv9MN5UuvW+0MgHSurKhEjflwScFF6tV50Wnt6afrmDlT0/+tvat2VDNdKsNcWYJrW7rRudSiFx/cwKNo5TrtFMGyCan1IARJVNqpKFMCtQOwdQV6TkvKdQwXdVo7Eh1mgEVJJLRiWQ0bBpOnEuKhUZ53UpZJ/lOcp1kOwk7yXRSUVdI9sSUxpInGFfAG5elXekSSWhZn++p4ypLeHKDyEo3hFQSkhcKElGcL6usei2pxWotNnn6/7kWSLUEcuEdY7Kpdgyaxf8+9CcaxQ8MJ5V6g7X5K+Tbu4E6naTUaWmGkmlmqOEpQp2hlV0t6Ql1dlpNbnR2Yjs7kX9uZqeT2en10jny3ezUBGTa2Ykq3N4MUTIhZnx3M1sDZaEHzYBX6fFOejhJYUdQ+DpSelsKXPntyy+40dAEhhBKA5oteAcA7hdh4k5y1QoAAA==");
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
