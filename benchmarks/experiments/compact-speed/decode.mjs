/* 0BSD, NeoX. Number-only finite-state and prefix candidates. */
const Q = 2 ** 23,
  split = 110,
  f1 = 58821,
  f0 = 58820,
  f2 = 413,
  a1 = split * f1,
  a2 = a1 + 16 * f0,
  a3 = a2 + 1920 * f2;
function ordinal(cp) {
  if (cp < 128) return cp === 0 || cp === 13 ? -1 : cp - 1 - (cp > 13);
  if (cp < 2048) return cp - 128;
  if (
    (cp >= 55296 && cp < 57344) ||
    (cp >= 64976 && cp <= 65007) ||
    cp >= 65534
  )
    return -1;
  return cp - 2048 - (cp >= 57344 ? 2048 : 0) - (cp >= 65008 ? 32 : 0);
}
export function ans(text, state, size, shift = 30) {
  const out = new Uint8Array(size),
    scale = 2 ** (shift - 23 + 8);
  let at = size;
  for (let i = text.length - 1; i >= 0; i--) {
    const cp = text.charCodeAt(i),
      d = ordinal(cp);
    if (d < 0) throw Error("Invalid payload character");
    let f, c;
    if (cp < 128) {
      if (d < split) {
        f = f1;
        c = d * f;
      } else {
        f = f0;
        c = a1 + (d - split) * f;
      }
    } else if (cp < 2048) {
      f = f2;
      c = a2 + d * f;
    } else {
      f = 3;
      c = a3 + d * 3;
    }
    const limit = f * scale;
    while (state >= limit) {
      if (!at) throw Error("Invalid payload length");
      out[--at] = state & 255;
      state = Math.floor(state / 256);
    }
    const q = (state / f) | 0;
    state = q * Q + state - q * f + c;
  }
  if (at || state !== 2 ** shift) throw Error("Invalid payload padding");
  return out;
}
export function ans32(text, state, size) {
  const out = new Uint8Array(size);
  let at = size;
  for (let i = text.length - 1; i >= 0; i--) {
    const cp = text.charCodeAt(i),
      d = ordinal(cp);
    if (d < 0) throw Error("Invalid payload character");
    let f, c;
    if (cp < 128) {
      if (d < split) {
        f = f1;
        c = d * f;
      } else {
        f = f0;
        c = a1 + (d - split) * f;
      }
    } else if (cp < 2048) {
      f = f2;
      c = a2 + d * f;
    } else {
      f = 3;
      c = a3 + d * 3;
    }
    while (state >= f * 256) {
      if (!at) throw Error("Invalid payload length");
      out[--at] = state & 255;
      state >>>= 8;
    }
    const q = (state / f) | 0;
    state = ((q << 23) + (state - q * f) + c) >>> 0;
  }
  if (at || state !== Q) throw Error("Invalid payload padding");
  return out;
}
const short = [110, 96, 34, 32],
  lengths = [7, 8, 14, 15, 21, 22, 28, 29],
  bases = [0, 220, 15104, 30400, 2062336, 4124740, 267911168, 535822400],
  powers = Float64Array.from({ length: 30 }, (_, i) => 2 ** i);
export function prefix(text, _state, size) {
  const out = new Uint8Array(size);
  let carry = 0,
    bits = 0,
    at = 0,
    lastWidth = 0,
    last = 0;
  for (let pos = 0; pos < text.length; pos++) {
    const cp = text.codePointAt(pos);
    if (cp > 65535) pos++;
    let w = cp < 128 ? 0 : cp < 2048 ? 1 : cp < 65536 ? 2 : 3;
    const d = w < 3 ? ordinal(cp) : ((cp >>> 16) - 1) * 65534 + (cp & 65535);
    if (d < 0 || (w === 3 && (cp & 65535) >= 65534))
      throw Error("Invalid payload character");
    const narrow = d < short[w],
      k = w * 2 + !narrow,
      width = lengths[k],
      code = bases[k] + d - (narrow ? 0 : short[w]),
      total = bits + width,
      rem = total & 7,
      n = total >>> 3;
    const word = ((carry * powers[width] + code) / powers[rem]) >>> 0;
    if (n === 4) out[at++] = word >>> 24;
    if (n >= 3) out[at++] = word >>> 16;
    if (n >= 2) out[at++] = word >>> 8;
    if (n) out[at++] = word;
    carry = code & ((1 << rem) - 1);
    bits = rem;
    last = code;
    lastWidth = width;
  }
  const pad = at * 8 + bits - size * 8;
  if (pad < 0 || pad >= lastWidth || last & ((1 << pad) - 1))
    throw Error("Invalid payload padding");
  return out;
}
