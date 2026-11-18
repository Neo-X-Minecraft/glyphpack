/* 0BSD, NeoX. Independent Number-based current compact ANS test oracle. */
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
export function ans(text, state, size) {
  const out = new Uint8Array(size),
    scale = 32768;
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
  if (at || state !== 2 ** 30) throw Error("Invalid payload padding");
  return out;
}
