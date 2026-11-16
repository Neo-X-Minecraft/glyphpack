// wasm-runtime.js
function failure(status) {
  return status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
    status === 2 ? "Invalid payload length" : status === 9 ? "Unsupported payload codec" : status === 10 ? "Unsupported memory optimization option" : status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure"
  );
}
function warmWasm(api2, codecs, heavy) {
  let status = api2.warmup(codecs, heavy);
  if (status) throw failure(status);
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

// stored.js
function trailerLength(kind, length, dataKind) {
  if (kind < 0 || kind > 2) throw Error("Invalid payload header");
  let trailer = kind === 1 ? 4 : kind === 2 ? 32 : 0;
  if (length < trailer) throw failure(2);
  if (dataKind !== 0 && kind !== dataKind)
    throw failure(5);
  return trailer;
}
function verifyStored(api2, bytes, trailer, dataKind) {
  if (dataKind !== 0) {
    let pointer = api2.input_ptr(Math.ceil(bytes.length / 2));
    if (!pointer && bytes.length) throw failure(8);
    new Uint8Array(api2.memory.buffer, pointer, bytes.length).set(bytes);
    let status = api2.verify_bytes(bytes.length, dataKind);
    if (status) throw failure(status);
  }
  return trailer ? bytes.subarray(0, bytes.length - trailer) : bytes;
}

// compact-guards.mjs
var special = /<(?:\/?script|!--|\x01\x01\x01)/i;
function unprotect(text, verifyFormat) {
  if (!special.test(text)) return text;
  if (/<(?!(?:\x01\x01\x01)(?:\/?script|!--|\x01\x01\x01))(?:\x01\x01\x01|\/?script|!--)/i.test(text))
    throw Error("Invalid payload padding");
  return text.replace(/<\x01\x01\x01/g, "<");
}

// compact-ans.mjs
var digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function runAns(api2, text, verifyFormat, dataKind) {
  let raw = unprotect(text, verifyFormat);
  if (raw.length < 15 || raw.slice(2, 5) !== "~c2")
    throw Error("Invalid UTF-8 header");
  let a = digits.indexOf(raw[5]), b = digits.indexOf(raw[6]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 7, length = 0, power = 1, d;
  do {
    if (start >= raw.length || power > 1073741824) throw failure(2);
    if (d = digits.indexOf(raw[start++]), d < 0) throw Error("Invalid UTF-8 header");
    length += (d & 31) * power, power *= 32;
  } while (d & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824) throw failure(2);
  if (power > 32 && !(d & 31)) throw Error("Invalid UTF-8 header");
  let state = 0, multiplier = 1;
  for (let i = 0; i < 7; i++) {
    if (start >= raw.length) throw failure(2);
    let value = digits.indexOf(raw[start++]);
    if (value < 0) throw Error("Invalid UTF-8 header");
    state += value * multiplier, multiplier *= 64;
  }
  let count = raw.length - start;
  if (state >= 2 ** 38 || length > count * 3) throw failure(2);
  trailerLength(raw.charCodeAt(1) - 48, length, dataKind);
  let pointer = api2.input_ptr(count);
  if (!pointer && count) throw failure(8);
  let view = new DataView(api2.memory.buffer, pointer, count * 2);
  for (let i = 0; i < count; i++)
    view.setUint16(i * 2, raw.charCodeAt(start + i), !0);
  let status = api2.decode_compact(
    length,
    state >>> 0,
    Math.floor(state / 4294967296),
    a | b << 6,
    raw.charCodeAt(1) - 48,
    dataKind,
    +verifyFormat
  );
  if (status) throw failure(status);
  let stored = api2.stored_len(), end = api2.payload_len(), out = new Uint8Array(stored);
  return out.set(new Uint8Array(api2.memory.buffer, api2.output_ptr(), stored)), end === stored ? out : out.subarray(0, end);
}

// utf8-model.mjs
var digits2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", forbidden = [0, 10, 13, 34, 38, 92], ranges = `\xC0-!\u0272\x90$!#"$!!$#!#!!!4!\u0100'\xC6!F"R"#N!!!"!"!);$&1*+!!N50!\x85(!&""!$@"!!>=y+!.K)'#"`, table;
function warmup() {
  if (table) return;
  table = new Int16Array(2048).fill(-1);
  for (let c = 1; c < 128; c++)
    forbidden.includes(c) || (table[c] = c << 8 | c);
  let ordinal = 0, end = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    let begin = end + ranges.charCodeAt(i) - 32;
    end = begin + ranges.charCodeAt(i + 1) - 32;
    for (let c = begin; c < end && ordinal < 1536; c++, ordinal++)
      table[c] = forbidden[ordinal >>> 8] << 8 | ordinal & 255;
  }
}
function prepare(text, offset = 0) {
  if (text.length - offset < 6 || text.slice(offset, offset + 3) !== "~u2")
    throw Error("Invalid UTF-8 header");
  let a = digits2.indexOf(text[offset + 3]), b = digits2.indexOf(text[offset + 4]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = offset + 5, length = 0, power = 1, digit;
  do {
    if (start >= text.length || power > 1073741824)
      throw Error("Invalid payload length");
    if (digit = digits2.indexOf(text[start++]), digit < 0) throw Error("Invalid UTF-8 header");
    length += (digit & 31) * power, power *= 32;
  } while (digit & 32);
  if (!Number.isSafeInteger(length) || length > 1073741824 || length > Math.floor((text.length - start) * 15 / 8))
    throw Error("Invalid payload length");
  if (power > 32 && !(digit & 31)) throw Error("Invalid UTF-8 header");
  return warmup(), { table, mask: a | b << 6, length, start };
}
function finish(valid, at, bits, length, last, width, body) {
  if (valid < 0) throw Error("Invalid payload character");
  let padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if (body && padding >= width || last & (1 << padding) - 1)
    throw Error("Invalid payload padding");
}

// utf8-unpack.mjs
function unpack(text, { table: table2, mask, length, start }, verifyFormat) {
  let out = new Uint8Array(length), end = text.length, pos = start, at = 0, carry = 0, valid = 0, c = 0, entry = 0, data = 0;
  for (; pos + 8 <= end && at + 15 <= length; )
    c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, c >= 128 && (out[at++] = data >>> 7 ^ mask), carry = data & 127, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 1 | data >>> 14) ^ mask, c >= 128 && (out[at++] = data >>> 6 ^ mask), carry = data & 63, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 2 | data >>> 13) ^ mask, c >= 128 && (out[at++] = data >>> 5 ^ mask), carry = data & 31, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 3 | data >>> 12) ^ mask, c >= 128 && (out[at++] = data >>> 4 ^ mask), carry = data & 15, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 4 | data >>> 11) ^ mask, c >= 128 && (out[at++] = data >>> 3 ^ mask), carry = data & 7, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 5 | data >>> 10) ^ mask, c >= 128 && (out[at++] = data >>> 2 ^ mask), carry = data & 3, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 6 | data >>> 9) ^ mask, c >= 128 && (out[at++] = data >>> 1 ^ mask), carry = data & 1, c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, out[at++] = (carry << 7 | data >>> 8) ^ mask, c >= 128 && (out[at++] = data ^ mask);
  let step = 0;
  for (; pos < end; )
    c = text.charCodeAt(pos++), entry = table2[c] ?? -1, valid |= entry, data = entry, step && (at < length && (out[at] = (carry << step | data >>> 15 - step) ^ mask), at++), c >= 128 && (at < length && (out[at] = data >>> 7 - step ^ mask), at++), carry = data & (1 << 7 - step) - 1, step = step + 1 & 7;
  return finish(
    valid,
    at,
    -(end - start) & 7,
    length,
    data,
    c < 128 ? 7 : 15,
    end > start
  ), out;
}

// utf8-compact.js
function warmCompact() {
  warmup();
}
function runCompact(api2, text, verifyFormat, dataKind) {
  if (text.length < 8) throw failure(2);
  if (text.slice(2, 5) === "~c2")
    return runAns(api2, text, verifyFormat, dataKind);
  let kind = text.charCodeAt(1) - 48, payload = text.slice(2);
  if (!payload.startsWith("~u2")) throw Error("Unsupported payload format");
  let raw = unprotect(payload, verifyFormat), header = prepare(raw), trailer = trailerLength(kind, header.length, dataKind);
  return verifyStored(
    api2,
    unpack(raw, header, verifyFormat),
    trailer,
    dataKind
  );
}

// decoder.js
var api = await loadWasm("H4sIAAAAAAACAzRIhWHDMBA8cXiXjtBFzEGDZC6fNy/n/xhpXwsA4sElEEwk+a2W5AeJRPGu36sjyb8oKKi2G6m0sQCEMEpA2pWgeFwWvXVhbetj7btnCVscc18cIQ9/Ic59HdJ8gFpfmzAOcRg66I0fh3sx25A+Vz4t4urYwG76wXfHv+J207G7np7j7Hk49ljZOe3qL1qrosFx5ohKclvUkiyZcfy6HWZmGIU55/yFdmg5zPfwOZyc8gfCfAnTOZwcA8dwVW1b42/WE84HK1UXvnpPvb712iDL3/eK/FurEG+FQvSgqLYK4YOiud3wI3XOLm609R27bv/w68/+oucM0EfEAX0OWNszfhQUZyVu137jg1/6cX9vl1ji7EY7vkNvFhGHWoraYnejnd+xK2dmfJreLTC2MT8URdRcJm3/9NGffVztzf0ww/JGu7hjEw5/lN1hA0jdHAtEnLqgrJL+zxDjfuKq2FEQhpoLIpWWqQzYsCugoUIGK10DCgrR+5T4dfubb33qe7GzBTRiFFJPI+Q0ZUNHDqk2cHboTIwZcpRYy9kacDaXaUuOf5CFTDDDQGrXzg5QsjHmCFnAw+zM8XEtFcbO1Fjz+ZOomsZQimlseXVSY4gU93N25EyKErVvFiORorKkx9n7IZN98MYn4BTtcWw54GmW6w2l41SqzpFjhQojqZdzEOwKzGslAQW1RIEcIylUcMT9bIRKIrjQyFnjTI4aCTI0claDFplIzRgKQxlqdJcHGgANYgylYIMM92O35MlmCxjJLDDAxu+IM0dIMXU25VXFaCSmYRb8WidYCuyI/pyiQC3nXAVSZXR3XKllkPBypEaKCmcUkWAsvspZjarbXYU+EnZLunbMVYoYGiVyTDCX85yk6PEOsKNwLbUGPNAAMSZSawCNBTslZ8Joc1QY++1vHTJehUyBGiNpxmgHEjFAisavbYq1Y27uJ2grEAF+3AyrbqFzqXV/lCi6LqHAKTEUX8KKT5B7xScgfbJb0gsRe44YrCmkGMGII6UGngJiukFxEMsYBWKM/eobGbI5SDxGisRrO4UWXhLJ1Kgxl2aMtvD85xj4tU2FoRFmglYj9Wg1Etl2coTWIEPVdSlFQ6QO8WVOFkSUS3oGhbJDW/EAwm2FCIlj1eP+B3oTDA54qwO3I+F25IessDz6KoTbzM+REydoDtw2Hu1lbgu/tim2ouS1oG06bhuEyO7hNoHuuvQhcDA+cKuFW91xu+jQ6o5bLd8gUkyO2S0OaPVpbrUMqU9zW3lWRMn/lNuNoF14JR+4FRJOcNsccQtBOzpw2wi3jee2hO3QNh23DRLMmNvJSW6b09w2IsDmNLehgz5wq/8ptytBu/VKzjsl909yW3Vd1GVuK+G26rhdXlIyc8tqX1/NbXWa20qGrE5zG6HpuG3+KbcQtEuv5AO3QsIJbvURt7v7cquFW91xe79LSmZuWe2Lq7nVp7nVIkB9mtu+Q9Xdyf+E2xBTQbu6505WJ7ltui4i1WNuG+G26bg9u6Rk5pbVvr2a2+Y0tyGaf3Qnz/6NO3knaM9O3MmLf3gnR17Jo9N3con1yTs5wVK4/ffuZFx9J6t/407ue25DRtsxS9WEOf/Dx+98fnQnhyLVe+7k8OhO3lxScshK7kiNQbSmfv/a/+2+OmyuoIM+HUH7SVcCSGqZPuKOW17g4vhOZui1MwtOl4gVNgg9uxtEgpelUsjiEWMhrqXjWtLC15JtcIXI/3iYeWZrGR01IqSSW2OGLQdI+lZ+zEUIyL8S/woKBfmVSMgusJS6S0pbS10tddcsYv/DK3Ty2wslx44lVigH1uKfObu+8YQolS7KDx5xC9BxQMcKgh8zstcStsSaT8geI+2wWYeM80KZwWLBTAXoI8dGQmjd8jGcYSshhGCDPjvH7DzDTpwLGWHH8EJE4qTJRCSKWhYykpUgRekLP8qczkMoZ0OckanI3HEB76712x/Vs299yBvDt+yC9kvDvU3uR1ja/LZVbehaSgW9vHRFZ39Lrq3sog33ZhOdI2kDJPu2d83WSGibLy8D1OREYhRqdY7apL1zSg6eEgTgYnSeUoBNy0DrNnlhGRz7E3d4i7u3fvemurde9xZ1b6F/y+mdtKOezx3Iytu31aj3tm7fdI2OX6jOqWPeBsxgTjUtJbyQYwlPTVDYZumpl5YcQGBySrkEQhw2/7+BSO8DIrG9FnszR6/9cO3MmJ5fapxZ0vNt9NGv2sAkvfPordH5xb8oGFuNxcvVOfkVxX7g7eovQRT8Rffe05D5rs58W4OI4kOKb/ObcsumL1zJ2YVp072dtPFtG4smECMWTUzaZ5IkzlgSW4RInQEKbJ5nDZLnXjMWxafNy9tAhND7SxFc+ofa/66+wvHTqxzfu8rxpRoTqPZ8b4cYYvLiFZtQ/GbV3pbtl4OXl4r3Vzu7Mxm54ExM461J+vXejFCS6GtaWkRrQybizvnrHSDrFBEbzapAbipClUE/PBDaNItDI+NHhoo1Uh1rpIuUEAnv7Ijt6MLusd27sBXb6sLus92/sGO24ws7YTtx3WQpT0YgWFeZ6AoK+d7ej74L28eAJibVxMidzRn09LmKBx68tAwJZ0zTDxA/KJLvJqZBTIxBq2Qv/PkUoW4DOhu1FFHQo3CYXjdVqzDd8z1yjcpVyO/O04Ym1qx8Po1ROWn8yDB4ahho5JRiNKZt76aZYfSgqDAVMmn3YlYzZvt2fs00Pa44u82T2L/XahXQbStZdDSSZdmSHCefv7v/P2kbhrLLbSbl+neZmcHtQtMsZ5ssMzMzb3uWmZkZDy3DgWUGb/ZeQaOmdj+nHc+8mdGb9+57czWeY4dvPtrjw8a4Jv1zs7TUoaV9yW5K7cythBVeWrl6AUtZ+2HJBUSp3yg4IxfkcMcuphodrcKwi+EcduPN+SkT0Al2I0SrcsAvmFRe5LJyTX1OnNnIIfww0yxZx9u5E3OJBzTV5+uAqK4G+piMYDjMu1qadw7zDuRyPPYTOqqIm63kMtvcPOl8Jp1/dtK5xaRzVySduyLp3BVJ565IOndF0rkrks5dTjqXcCK6xaQjhw20yVz9bbyFbi6hePtiGGHIelfuj8PGbIxwzSKeIV/qcaOuxBYbXPWugZS7Uum1lEBdAwjCFeKRvjwukfFfxPwNEJx9SGAcq0xpjseaeuQAkzJRKptPgQ1caVAdNHV8rTLhuRRAMlLCQnVyVH8mJLwEgfaTQtH6aX97RkGXcWBpiUxdSlKbMXt45OyDTTQ5U2u/ayCTFim9diDQPpgyrAjtaYV62VgYennBNgrdbHtX0bbXnm3ba3PbAuPQ6/2NZRtTELh3K+c1UFKgHE5KLIsdDmNeYkgqvJaCArwB9bYDz4fXfJ2IboUOA8GzeMCOJF2DTn/K4BaKRrFROqetaDffVp1g4Va1WxZLNNoJnvmA0iuKJRrvBO/48ROuLJZoohNc9vWf3rlYog2dYNvfbv6mYok2doLZvzx4R7FEmzrBk07f/6PFEq3pBPf/daVdLNFaRMblCx5YhB2l1sbDwvpdXjzUCb1K1b/0sssbQVjrW3WTK66MR9LBerwubVwar+8yazDto8x+9kWbZUTQr6zk+r9c7x+44MKLLr4k2iLDMpT2s49j7MdK62R9l/5uuqd76DaJkZK59NrzufTa3KXXXnOXZnosu+cGcGlnD927EiPrmUvPPZ9Lz81deu41d2lvj2X33QAuHemhezIxUmUuLZ7PpcXcpcVr7tL+HsseuAFcGu6he0icfcl7wDF9+xuznf7o4LmHvOhQJ5hGXSzRNlMGn+2Oml326uEue3qqy97f3oUjdmCf74rWyZFovUzJGjkAgpJxfMQtOdS5pRyWtTIUH2HvKHuvkiZ6RzuhtpXllp1S1fcqtb4gjLdyeBeGbhkPmgs777Bk0ASdU1bnFvFYl+mJtpvJ+LnTo3HZLptkMh7hqhOcNyXbsGo3NWs4vFYmuqiZkB2yUfZRyQbOasrBHkomOTyEWecqGZRdslWukuF4FxWNceb2VI0FPSXoqUBPCD3xDg5uk1Fpyf4zMI72mNwSI4B82UW2hmRSmrKXzcEE7e4Pp1g3MYcGX5YaXE6xTp6b7OHocOroYFdHh2QYy0+fWXxTj8UPcfBwt8WjDdIE6HuSVEHirJGpHjpG06hO3AgOzJxxYE2PxZsc3NHVgQmZQrjXyXYquZm0UjPHb0Azt2Zm7kw0SBLJtT0MPZhkm2yFmqF0+aHc0HEYOipbZBsePGc0HqLqq/j0Tqge6pXyJDo+nFg4lFuY2Sebk4zkvI1U0sW+bSk8Q13sG5UDULQPTLgfjLoHbLsXhD4S7ZNpvExm8B4zeB+uj2ZkMDKyJZqWzdEWWRdtlhLPbCWeKDdwwyKnJrj7EZpDDAQ8H5Um6lFub9QbwRXbUW8if6FeQ85CvTa5bOBX3QNUZuOx8WX6Zs0iE2fTdNK3YbmP1M7+eHN2MGdad1GzqdNQnVUaFrG24y3pyZ2n8zh0ppdPvHr67MO5JRcWD8AXdj8APzcXFPVCKByAF+vnHs49Hs49Hs49Hs4zpUA3XSraEpR8dNOEQ6Gt/OTf8um3hODTgJJsSawiJA0r9pr6lYRggkJ/U7+UwjgFt6lfSGGUgt/UCVIbKfQ19TMpbKJQa+qnUlhDYaCpn5gASiFo6sX+7HtNyO81uzsNHXnECiHczQP2jYGTw0ud8rlwjcDRyEMNH6N+1HAvclkDRY7DqagPNfyJaqjhSjTAGuAGgUVod7VCCxUv04iskyELEFcBWMB3KSoAdyEqQEa0AVaACjB5qACQgypo5hHQcXk5AroQAQh+HgEKfXkEKNTyCFAYyCNAIcgjQKHKCBB2O3IZBF5b8NJNnNi7kQPgSJkBKDMA5UIAyisC4GcB6MsCUMsCMJAFIMgCUGUAnDQADgPgMQBeFoByMQBE/sIU+XqKfJAi76XIMwDVMwGwY2c5AHYhABCqywGwi1vALm4Bu7gF7OIWsPMtIG563ZJ+jffi8o0Hfpnge8Vv8gXwnRXgV69N9nsp+B7BLy/zCtYi+F4CPqoqwffS7PfS7PfS7PfS7PcYg8J3bidjKvYY5SNDArnsEI1WZyBR9UxYpIAmLvzbq5Xfr4w2FfOlxzsjGs1DDf90VeuT7sJNFeCIg9XK2OTn9B9RaYVKNOGnkiULtdGATZlF/DnsdibV+x7vxFVRkDLVcXhqxj4Zl2fkqbeAJeW3tI5zptEHnGlTikrAR0+bryVzRfHy+mNJO3IxYryoZD6V6nHMIwlict/+yOO8lTYLohCz+z8cWLB1pBH7vBJzpcKZFRg2nzaWluy2qT88ru2GnlZyMekcnVZmYX+ofS5I5lFcSSpo0ByGAUBap0SfmpEnPzEqm2+hV3H4e2zgLhXtnKBV5NCTkwTLfCi12JLQWHNto4+usVSszaIF9wR1HS+6mcXFj7iB7RsLGOpazbEKf46V9HPuH+3jZvFd9v7QhtRZsltJ411OG05hSPDCgiqCherpLynj86kvKWNK2DILJ0S3ze8Vght5xmGw9pGFxbsNKstoCRvIWJeJX5XM3MgXxc2W+iI+zI99OlBJHGAfWnW0EhMrBRM9SDSRjaKJkGmXe6fQQs6yDd9vE2rSKcBjGvFKiuwH0NQhB/1SbSNZxD6Bi0U8sbS09JfgdmJFDgTvqSRGAu4HVb+oxbtaLX43JZUEbnpWq7mq8Ocqn70ZmBUQJuBkFDOcgeO1c+I5p2tnG2BnXuhU59OpU107nS9YqVNnOjEvtsznv2o/ONKizUffN39MrPYpKbHvWJLZlzz5ifOBnc38XD7zY/lMunv01AwGTqaz5+dn3vy3p9vzgc6eeVX2yC+yJyroOWZ+/dxP2xCyRwIrm5zNfWw+dfGhRnF7ftJuNdrmHonwh/9QQIZh3cKqv/7pX+15UpwvteRimeCIExKDhIBuBbychE/M9/L9p7j9Aya4qIZYdVRiHWVGalM2aPPHh4r3KhLws7O6c2uhXE/kOuVZvIAaUcmXwAiIU0p9Get+07LchZydLIYLbfPTx4PUFavIYlCVUQdDlTSsOZDA55L5R5ycJSKL6FgpuVkZuZHaNKktdhJy0+I04lI7smGxzYk2uS1t/C/jNp1zmy5wGxcRK+c2Gw0aIKWU2yKXJC0qkVy/ojLuZet7eYu0x9aCZWXvBr1a6QVTIoEgEpcbLYqQpq2U9ulsCz2il8kweVbVLSLPOOTI6xXI67OQ90UnuPs1ZSqmyqA1EEzf/5rGKoi7/0F979l74hfLa9LfQM9OPgI/vF5zYvbeax42d78t+U+ip2ZPqF7zpqay/xQecM8TDzjf5GMPvBeHeZE9jM8LUCoovHviXRPvlniXxDts3lnzjpp30iOYP4F5f0GZRMnlf6KEBfm3KKsK8o+4RkH+Isq6gvw1lP6C/CmUNSi3hXwF6mdrpYYK8jMgj6FWiDtj45ccCv8HrZ/Lhq0uAAA=");
function warmup2(codecs, memoryHeavy) {
  if (codecs === void 0 && (codecs = ["utf8-compact"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let codec = codecs[i], bit = codec === "utf8-compact" ? 16 : 0;
    if (!bit) throw failure(9);
    if (typeof (memoryHeavy === void 0 ? !1 : memoryHeavy[i]) != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit;
  }
  warmWasm(api, mask & 7, heavy), mask & 16 && warmCompact();
}
function binary(text) {
  if (text.length < 2) throw failure(2);
  if (text.charCodeAt(0) === 11) throw failure(9);
  if (text.charCodeAt(0) === 14) return runCompact(api, text, !0, 2);
  throw failure(9);
}
export {
  binary,
  warmup2 as warmup
};
