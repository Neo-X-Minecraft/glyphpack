// 0BSD, NeoX. Experiment-only entry. Build constants specialize every decoder;
// payloads and helpers are measured separately, never production fallbacks.
import { api, checked } from "./verify.js";
const R = PACK_RADIX,
  M = PACK_METHOD;
const encoder = PACK_BACKEND === 3 ? new TextEncoder() : null;
const table =
  PACK_BACKEND === 1 || PACK_BACKEND === 3
    ? null
    : (() => {
        const table = new Uint16Array(65536);
        if (R > 256) {
          let digit = 0;
          for (let c = 0; c < 65536; c++)
            if (
              c !== 0 &&
              c !== 13 &&
              c !== 92 &&
              c !== 96 &&
              (c < 55296 || c > 57343)
            )
              table[c] = ++digit;
          return table;
        }
        const chars = new TextDecoder("windows-1252", { fatal: true }).decode(
          Uint8Array.from({ length: 256 }, (_, i) => i),
        );
        let radix = 0;
        for (let i = 0; i < 256; i++) {
          if (i === 13 || i === 96 || (R === 253 && i === 92)) continue;
          table[i === 0 ? 65533 : chars.charCodeAt(i)] = ++radix;
        }
        if (radix !== R) throw Error("Bad experimental alphabet");
        return table;
      })();
function bad() {
  throw Error("Invalid experimental packet");
}
function js(text, mode) {
  let pos = 0;
  const d = () => {
    const v = table[text.charCodeAt(pos++)];
    if (!v) bad();
    return v - 1;
  };
  const num = (n) => {
    let v = 0,
      p = 1;
    for (let i = 0; i < n; i++) {
      v += d() * p;
      p *= R;
    }
    return v;
  };
  const header = R > 256 ? 3 : 6;
  const settings = num(R > 256 ? 1 : 2),
    size = num(R > 256 ? 2 : 4),
    kind = (settings >>> 8) & 3,
    mask = settings & 255;
  const trailer = kind === 2 ? 32 : kind === 1 ? 4 : 0;
  if (
    settings >>> 10 !== M ||
    kind === 3 ||
    size < trailer ||
    size > (text.length - header) * (R > 256 ? 2 : 1) ||
    (mode && mode !== kind)
  )
    bad();
  const out = new Uint8Array(size),
    view = new DataView(out.buffer),
    xor = (mask * 0x01010101) | 0;
  let at = 0;
  const put = (b) => {
    if (at < size) out[at] = b ^ mask;
    else if (b) bad();
    at++;
  };
  if (M === 8 || M === 9) {
    const L = M === 9 ? 2147483648 : 65536,
      stateDigits = 3;
    if (text.length - pos < 4 * stateDigits + Math.ceil(size / 2)) bad();
    let a = num(stateDigits),
      b = num(stateDigits),
      c = num(stateDigits),
      e = num(stateDigits);
    for (const x of [a, b, c, e]) if (x < L || x >= R * L) bad();
    const norm = (x) => {
      x = (M === 9 ? Math.floor(x / 65536) : x >>> 16) * R + d();
      if (x < L) x = x * R + d();
      return x;
    };
    while (at + 8 <= size) {
      const ab = (a & 65535) | (b << 16),
        ce = (c & 65535) | (e << 16);
      a = norm(a);
      b = norm(b);
      c = norm(c);
      e = norm(e);
      view.setUint32(at, ab ^ xor, true);
      view.setUint32(at + 4, ce ^ xor, true);
      at += 8;
    }
    const states = [a, b, c, e];
    for (let i = 0; at < size; i++) {
      const word = states[i] & 65535;
      put(word & 255);
      put(word >>> 8);
      states[i] = norm(states[i]);
    }
    if (pos !== text.length || states.some((x) => x !== L)) bad();
  } else if (M === 5 || M === 6) {
    const L = R > 256 ? 32768 : 8388608,
      lanes = M === 5 ? 1 : 4,
      stateDigits = R > 256 ? 2 : 4;
    const body = text.length - pos - stateDigits * lanes;
    if (body < 0 || size > (R > 256 ? body * 2 + lanes : body)) bad();
    const states = Array.from({ length: lanes }, () => num(stateDigits));
    for (const x of states) if (x < L || x >= R * L) bad();
    const norm = (x) => {
      x >>>= 8;
      if (R <= 256 || x < L) x = x * R + d();
      if (x < L) x = x * R + d();
      return x;
    };
    if (M === 6) {
      let [a, b, c, e] = states;
      while (at + 4 <= size) {
        const word =
          (a & 255) | ((b & 255) << 8) | ((c & 255) << 16) | (e << 24);
        a = norm(a);
        b = norm(b);
        c = norm(c);
        e = norm(e);
        view.setUint32(at, word ^ xor, true);
        at += 4;
      }
      states[0] = a;
      states[1] = b;
      states[2] = c;
      states[3] = e;
      for (let i = 0; at < size; i++) {
        put(states[i] & 255);
        states[i] = norm(states[i]);
      }
    } else {
      let x = states[0];
      while (at < size) {
        put(x & 255);
        x = norm(x);
      }
      states[0] = x;
    }
    if (pos !== text.length || states.some((x) => x !== L)) bad();
  } else if (M === 4) {
    const blocks = Math.ceil((size * 8) / 703),
      radix4 = BigInt(R ** 4),
      mask32 = 4294967295n;
    if (R !== 254 || text.length - pos !== blocks * 88) bad();
    let carry = 0,
      shift = 0;
    for (let block = 0; block < blocks; block++) {
      const values = [];
      for (let i = 0; i < 22; i++) values.push(num(4));
      let value = 0n;
      for (let i = 21; i >= 0; i--) value = value * radix4 + BigInt(values[i]);
      if (value >> 703n) bad();
      for (let i = 0; i < 22; i++) {
        const word = Number(value & mask32);
        value >>= 32n;
        const width = i === 21 ? 31 : 32;
        const low = carry | (word << shift);
        const total = shift + width,
          advance = total >>> 3;
        for (let j = 0; j < advance; j++) put((low >>> (j * 8)) & 255);
        carry = advance === 3 ? low >>> 24 : shift ? word >>> (32 - shift) : 0;
        shift = total & 7;
      }
    }
    if (at < size || carry) bad();
  } else {
    const k = [2, 4, 6, 8][M],
      bits = k * 8;
    if ((text.length - pos) % k) bad();
    const capacity = R ** k;
    const threshold = capacity - 2 ** (bits - 1) - 1;
    const thresholdBig = M === 3 ? BigInt(R) ** 8n - (1n << 63n) - 1n : 0n;
    const thresholdHi = M === 3 ? Number(thresholdBig >> 32n) : 0;
    const thresholdLo = M === 3 ? Number(thresholdBig & 4294967295n) : 0;
    let carry = 0,
      shift = 0,
      lastLo = 0,
      lastHi = 0,
      advance = 0;
    while (pos < text.length) {
      if (at >= size) bad();
      let low,
        high = 0,
        narrow;
      if (M === 3) {
        // Exact 32x32->64 multiplication from four 16-bit products.
        const a = num(4),
          b = num(4),
          base = R ** 4;
        const a0 = base & 65535,
          a1 = base >>> 16,
          b0 = b & 65535,
          b1 = b >>> 16;
        const p = a0 * b0,
          mid = (p >>> 16) + a1 * b0 + a0 * b1;
        const bottom = (mid & 65535) * 65536 + (p & 65535) + a;
        const hi =
          (a1 * b1 +
            Math.floor(mid / 65536) +
            Math.floor(bottom / 4294967296)) >>>
          0;
        const lo = bottom >>> 0;
        narrow =
          (hi & 2147483647) > thresholdHi ||
          ((hi & 2147483647) === thresholdHi && lo > thresholdLo);
        low = carry | (lo << shift);
        high = shift ? (lo >>> (32 - shift)) | (hi << shift) : hi;
        if (shift === 0 && narrow) {
          carry = high >>> 24;
          shift = 7;
          advance = 7;
        } else {
          carry = shift ? hi >>> (32 - shift) : 0;
          shift -= +narrow;
          advance = 8;
        }
      } else {
        const value = num(k);
        narrow =
          (M === 0
            ? value & 32767
            : M === 1
              ? value & 2147483647
              : value % 140737488355328) > threshold;
        low = carry | (value << shift);
        high = M === 2 ? Math.floor(value / 2 ** (32 - shift)) : 0;
        const total = shift + bits - +narrow;
        advance = total >>> 3;
        if (M === 2) {
          carry = high >>> (8 * (advance - 4));
        } else {
          carry = advance === 4 ? 0 : low >>> (8 * advance);
        }
        shift = total & 7;
        // A 32-bit narrow transition retains high bits of the incoming
        // value, even when the speculative word is written unaligned.
        if (M === 1)
          carry =
            advance === 3
              ? low >>> 24
              : shift
                ? value >>> (32 - (shift + +narrow))
                : 0;
      }
      lastLo = low;
      lastHi = high;
      if (at + k <= size) {
        if (k >= 4) view.setUint32(at, low ^ xor, true);
        else view.setUint16(at, low ^ xor, true);
        if (k === 6) view.setUint16(at + 4, high ^ xor, true);
        if (k === 8) view.setUint32(at + 4, high ^ xor, true);
        at += advance;
      } else {
        for (let j = 0; j < advance; j++)
          put(j < 4 ? (low >>> (8 * j)) & 255 : (high >>> (8 * (j - 4))) & 255);
      }
    }
    const remain = size - at + advance;
    if (at < size || (text.length > 6 && remain <= 0) || carry) bad();
    if (k <= 4) {
      if (remain < 4 && lastLo >>> (8 * remain)) bad();
    } else if (remain < 4) {
      if (lastHi || lastLo >>> (8 * remain)) bad();
    } else if (remain < k && lastHi >>> (8 * (remain - 4))) bad();
  }
  return checked(out, kind, mode);
}
function wasm(text, mode) {
  const len = text.length,
    digits = PACK_BACKEND === 2,
    utf8 = PACK_BACKEND === 3;
  // TextEncoder replaces lone surrogates. Reject the entire surrogate range
  // before conversion so format checking remains exact for this BMP alphabet.
  if (utf8 && /[\uD800-\uDFFF]/.test(text)) bad();
  const p = api.input_ptr(len * (utf8 ? 3 : digits ? 1 : 2));
  if (!p && len) bad();
  let written = 0;
  if (utf8) {
    const result = encoder.encodeInto(
      text,
      new Uint8Array(api.memory.buffer, p, len * 3),
    );
    if (result.read !== len) bad();
    written = result.written;
  } else if (digits) {
    const input = new Uint8Array(api.memory.buffer, p, len);
    for (let i = 0; i < len; i++) {
      const v = table[text.charCodeAt(i)];
      if (!v) bad();
      input[i] = v - 1;
    }
  } else {
    const input = new Uint16Array(api.memory.buffer, p, len);
    for (let i = 0; i < len; i++) input[i] = text.charCodeAt(i);
  }
  if (api.decode(len, utf8 ? 3 : +digits, mode, written)) bad();
  const n = api.stored_len(),
    end = api.payload_len();
  const out = new Uint8Array(n);
  out.set(new Uint8Array(api.memory.buffer, api.output_ptr(n), n));
  return end === n ? out : out.subarray(0, end);
}
export function binary(text, mode = 2) {
  return PACK_BACKEND === 0 ? js(text, mode) : wasm(text, mode);
}
export function memory() {
  return api.memory.buffer.byteLength;
}
