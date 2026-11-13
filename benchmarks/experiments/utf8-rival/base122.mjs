/* 0BSD, NeoX. Further Base122 tuning, same upstream wire format and permissive
 * input policy. These baselines deliberately retain fast oversized buffers. */
const illegal = [0, 10, 13, 34, 38, 92];
export function high122(text) {
  const out = new Uint8Array(Math.floor(text.length * 1.75));
  let q = 0,
    bits = 0,
    at = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i),
      index = (c >>> 8) & 7,
      wide = c >= 128 && index !== 7,
      w = wide ? 14 : 7,
      data = c < 128 ? c : wide ? (illegal[index] << 7) | (c & 127) : c & 127;
    const total = bits + w;
    q |= data << (32 - total);
    out[at] = q >>> 24;
    out[at + 1] = q >>> 16;
    const advance = total >>> 3;
    at += advance;
    q <<= advance * 8;
    bits = total & 7;
  }
  return out.subarray(0, at);
}
export function block4(text) {
  const n = text.length,
    out = new Uint8Array(Math.floor(n * 1.75)),
    view = new DataView(out.buffer);
  let q = 0,
    bits = 0,
    at = 0,
    i = 0;
  while (i < n) {
    if (i + 4 <= n) {
      const a = text.charCodeAt(i),
        b = text.charCodeAt(i + 1),
        c = text.charCodeAt(i + 2),
        d = text.charCodeAt(i + 3);
      if ((a | b | c | d) < 128) {
        const word =
            (q & ((1 << bits) - 1)) * 268435456 +
            ((a << 21) | (b << 14) | (c << 7) | d),
          total = bits + 28,
          count = total >>> 3;
        bits = total & 7;
        const value = Math.floor(word / 2 ** bits);
        view.setUint32(at, count === 3 ? value << 8 : value, false);
        q = word & ((1 << bits) - 1);
        at += count;
        i += 4;
        continue;
      }
    }
    const c = text.charCodeAt(i++);
    if (c < 128) {
      q = (q << 7) | c;
      bits += 7;
    } else {
      const index = (c >>> 8) & 7;
      if (index !== 7) {
        q = (q << 14) | (illegal[index] << 7) | (c & 127);
        bits += 14;
      } else {
        q = (q << 7) | (c & 127);
        bits += 7;
      }
    }
    if (bits >= 8) {
      bits -= 8;
      out[at++] = q >>> bits;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = q >>> bits;
      }
    }
  }
  return out.subarray(0, at);
}
export function blockStores(text) {
  const n = text.length,
    out = new Uint8Array(Math.floor(n * 1.75)),
    view = new DataView(out.buffer);
  let q = 0,
    bits = 0,
    at = 0,
    i = 0;
  while (i < n) {
    if (bits === 0 && i + 8 <= n) {
      const a = text.charCodeAt(i),
        b = text.charCodeAt(i + 1),
        c = text.charCodeAt(i + 2),
        d = text.charCodeAt(i + 3),
        e = text.charCodeAt(i + 4),
        f = text.charCodeAt(i + 5),
        g = text.charCodeAt(i + 6),
        h = text.charCodeAt(i + 7);
      if ((a | b | c | d | e | f | g | h) < 128) {
        view.setUint32(
          at,
          (a << 25) | (b << 18) | (c << 11) | (d << 4) | (e >>> 3),
          false,
        );
        view.setUint32(
          at + 4,
          ((e & 7) << 29) | (f << 22) | (g << 15) | (h << 8),
          false,
        );
        at += 7;
        i += 8;
        q = 0;
        continue;
      }
    }
    const c = text.charCodeAt(i++);
    if (c < 128) {
      q = (q << 7) | c;
      bits += 7;
    } else {
      const index = (c >>> 8) & 7;
      if (index !== 7) {
        q = (q << 14) | (illegal[index] << 7) | (c & 127);
        bits += 14;
      } else {
        q = (q << 7) | (c & 127);
        bits += 7;
      }
    }
    if (bits >= 8) {
      bits -= 8;
      out[at++] = q >>> bits;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = q >>> bits;
      }
    }
  }
  return out.subarray(0, at);
}

// Eight decoded 7-bit groups per lap, with a pending group for wide symbols.
// Constant shifts also benefit the original Base122 wire format.
export function groupUnroll(text) {
  const out = new Uint8Array(Math.floor(text.length * 1.75));
  let i = 0,
    at = 0,
    pending = -1,
    c = 0,
    carry = 0;
  outer: while (i < text.length || pending >= 0) {
    if (pending >= 0) {
      c = pending;
      pending = -1;
    } else {
      if (i >= text.length) break outer;
      c = text.charCodeAt(i++);
      if (c >= 128) {
        const index = (c >>> 8) & 7;
        if (index !== 7) {
          pending = c & 127;
          c = illegal[index];
        } else c &= 127;
      }
    }
    carry = c & 127;
    if (pending >= 0) {
      c = pending;
      pending = -1;
    } else {
      if (i >= text.length) break outer;
      c = text.charCodeAt(i++);
      if (c >= 128) {
        const index = (c >>> 8) & 7;
        if (index !== 7) {
          pending = c & 127;
          c = illegal[index];
        } else c &= 127;
      }
    }
    out[at++] = (carry << 1) | (c >>> 6);
    carry = c & 63;
    if (pending >= 0) {
      c = pending;
      pending = -1;
    } else {
      if (i >= text.length) break outer;
      c = text.charCodeAt(i++);
      if (c >= 128) {
        const index = (c >>> 8) & 7;
        if (index !== 7) {
          pending = c & 127;
          c = illegal[index];
        } else c &= 127;
      }
    }
    out[at++] = (carry << 2) | (c >>> 5);
    carry = c & 31;
    if (pending >= 0) {
      c = pending;
      pending = -1;
    } else {
      if (i >= text.length) break outer;
      c = text.charCodeAt(i++);
      if (c >= 128) {
        const index = (c >>> 8) & 7;
        if (index !== 7) {
          pending = c & 127;
          c = illegal[index];
        } else c &= 127;
      }
    }
    out[at++] = (carry << 3) | (c >>> 4);
    carry = c & 15;
    if (pending >= 0) {
      c = pending;
      pending = -1;
    } else {
      if (i >= text.length) break outer;
      c = text.charCodeAt(i++);
      if (c >= 128) {
        const index = (c >>> 8) & 7;
        if (index !== 7) {
          pending = c & 127;
          c = illegal[index];
        } else c &= 127;
      }
    }
    out[at++] = (carry << 4) | (c >>> 3);
    carry = c & 7;
    if (pending >= 0) {
      c = pending;
      pending = -1;
    } else {
      if (i >= text.length) break outer;
      c = text.charCodeAt(i++);
      if (c >= 128) {
        const index = (c >>> 8) & 7;
        if (index !== 7) {
          pending = c & 127;
          c = illegal[index];
        } else c &= 127;
      }
    }
    out[at++] = (carry << 5) | (c >>> 2);
    carry = c & 3;
    if (pending >= 0) {
      c = pending;
      pending = -1;
    } else {
      if (i >= text.length) break outer;
      c = text.charCodeAt(i++);
      if (c >= 128) {
        const index = (c >>> 8) & 7;
        if (index !== 7) {
          pending = c & 127;
          c = illegal[index];
        } else c &= 127;
      }
    }
    out[at++] = (carry << 6) | (c >>> 1);
    carry = c & 1;
    if (pending >= 0) {
      c = pending;
      pending = -1;
    } else {
      if (i >= text.length) break outer;
      c = text.charCodeAt(i++);
      if (c >= 128) {
        const index = (c >>> 8) & 7;
        if (index !== 7) {
          pending = c & 127;
          c = illegal[index];
        } else c &= 127;
      }
    }
    out[at++] = (carry << 7) | (c >>> 0);
    carry = c & 0;
  }
  return out.subarray(0, at);
}
