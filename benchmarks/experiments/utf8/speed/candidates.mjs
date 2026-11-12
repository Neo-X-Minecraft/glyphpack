/* 0BSD, NeoX. Wire-compatible decoder screens. Every path validates symbols,
 * coverage and canonical padding and returns exactly sized, owned bytes. */
import { prepare, fail } from "./model-wide.mjs";
const splitCache = /* @__PURE__ */ new WeakMap(),
  sentinelCache = /* @__PURE__ */ new WeakMap(),
  stateCache = /* @__PURE__ */ new WeakMap(),
  wideStateCache = /* @__PURE__ */ new WeakMap();

// Keep live bits at the top of one register. Speculative stores are overwritten
// before they become output; typed-array stores past the final length are ignored.
export function speculative(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length);
  let q = 0,
    bits = 0,
    at = 0,
    last = 0,
    lastWord = 0,
    lastTotal = 0;
  for (let pos = start; pos < text.length; pos++) {
    const c = text.charCodeAt(pos),
      e = table[c];
    if (!e) throw Error("Invalid payload character");
    const w = c < 128 ? 7 : e >>> 16,
      data = c < 128 ? c : e & 32767;
    q |= data << (32 - bits - w);
    lastWord = q;
    last = w;
    lastTotal = bits + w;
    out[at] = (q >>> 24) ^ mask;
    if (c >= 128) out[at + 1] = (q >>> 16) ^ mask;
    const advance = lastTotal >>> 3;
    at += advance;
    q <<= advance * 8;
    bits = lastTotal & 7;
  }
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if (
    (text.length > start && padding >= last) ||
    (lastWord >>> (32 - lastTotal)) & ((1 << padding) - 1)
  )
    throw Error("Invalid payload padding");
  return out;
}

// Same speculative register, but a single unaligned 32-bit store writes the
// bulk. The last three bytes use typed stores so DataView cannot overrun.
export function wordStores(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    view = new DataView(out.buffer),
    xor = mask * 0x01010101;
  let q = 0,
    bits = 0,
    at = 0,
    pos = start,
    last = 0,
    lastWord = 0,
    lastTotal = 0;
  while (pos < text.length && at + 4 <= length) {
    const c = text.charCodeAt(pos++),
      e = table[c];
    if (!e) throw Error("Invalid payload character");
    const w = c < 128 ? 7 : e >>> 16,
      data = c < 128 ? c : e & 32767;
    q |= data << (32 - bits - w);
    lastWord = q;
    last = w;
    lastTotal = bits + w;
    view.setUint32(at, q ^ xor, false);
    const advance = lastTotal >>> 3;
    at += advance;
    q <<= advance * 8;
    bits = lastTotal & 7;
  }
  while (pos < text.length) {
    const c = text.charCodeAt(pos++),
      e = table[c];
    if (!e) throw Error("Invalid payload character");
    const w = c < 128 ? 7 : e >>> 16,
      data = c < 128 ? c : e & 32767;
    q |= data << (32 - bits - w);
    lastWord = q;
    last = w;
    lastTotal = bits + w;
    out[at] = (q >>> 24) ^ mask;
    out[at + 1] = (q >>> 16) ^ mask;
    const advance = lastTotal >>> 3;
    at += advance;
    q <<= advance * 8;
    bits = lastTotal & 7;
  }
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if (
    (text.length > start && padding >= last) ||
    (lastWord >>> (32 - lastTotal)) & ((1 << padding) - 1)
  )
    throw Error("Invalid payload padding");
  return out;
}

// Separate byte widths and 16-bit data values: 6 KiB rather than 8 KiB, at the
// cost of a second load for non-ASCII symbols. The prototype reuses prepare().
export function splitTables(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length);
  let model = splitCache.get(table);
  if (!model) {
    const widths = new Uint8Array(2048),
      values = new Uint16Array(2048);
    for (let c = 0; c < 2048; c++) {
      widths[c] = table[c] >>> 16;
      values[c] = table[c] & 32767;
    }
    model = { widths, values };
    splitCache.set(table, model);
  }
  const { widths, values } = model;
  let q = 0,
    bits = 0,
    at = 0,
    last = 0;
  for (let pos = start; pos < text.length; pos++) {
    const c = text.charCodeAt(pos),
      w = widths[c];
    if (!w) throw Error("Invalid payload character");
    last = w;
    if (c < 128) {
      if (bits === 0) {
        q = c;
        bits = 7;
      } else {
        q = (q << 7) | c;
        bits--;
        out[at++] = (q >>> bits) ^ mask;
      }
    } else {
      q = (q << w) | values[c];
      bits += w - 8;
      out[at++] = (q >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (q >>> bits) ^ mask;
      }
    }
  }
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if ((text.length > start && padding >= last) || q & ((1 << padding) - 1))
    throw Error("Invalid payload padding");
  return out;
}

// A leading sentinel encodes width in a 16-bit entry. clz32 is a native integer
// instruction, letting the generic loop trade arithmetic for a smaller table.
export function sentinel(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length);
  let values = sentinelCache.get(table);
  if (!values) {
    values = new Uint16Array(2048);
    for (let c = 0; c < 2048; c++)
      if (table[c]) values[c] = (1 << (table[c] >>> 16)) | (table[c] & 32767);
    sentinelCache.set(table, values);
  }
  let q = 0,
    bits = 0,
    at = 0,
    last = 0;
  for (let pos = start; pos < text.length; pos++) {
    const e = values[text.charCodeAt(pos)];
    if (!e) throw Error("Invalid payload character");
    const w = 31 - Math.clz32(e);
    q = (q << w) | (e ^ (1 << w));
    bits += w;
    last = w;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (q >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (q >>> bits) ^ mask;
      }
    }
  }
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if ((text.length > start && padding >= last) || q & ((1 << padding) - 1))
    throw Error("Invalid payload padding");
  return out;
}

// Incoming symbols always contain at least seven bits. Any surviving carry
// therefore comes entirely from this symbol, independent of the old carry.
// Eight rows can precompute all work except merging the old carry into byte 0.
function transitions(original, stride) {
  const out = new Uint32Array(stride * 8);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 2048; c++) {
      const e = original[c];
      if (!e) continue;
      const width = e >>> 16,
        data = e & 32767,
        total = r + width,
        advance = total >>> 3,
        next = total & 7;
      const a = advance ? (data >>> (total - 8)) & 255 : 0,
        b = advance === 2 ? (data >>> (total - 16)) & 255 : 0;
      out[r * stride + c] =
        a |
        (b << 8) |
        (advance << 16) |
        (next << 18) |
        ((data & ((1 << next) - 1)) << 21) |
        (1 << 28);
    }
  return out;
}
export function stateTable(text) {
  return stateDecode(text, false);
}
export function wideStateTable(text) {
  return stateDecode(text, true);
}
function stateDecode(text, wide) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    cache = wide ? wideStateCache : stateCache;
  let model = cache.get(table);
  if (!model) {
    model = transitions(table, wide ? 65536 : 2048);
    cache.set(table, model);
  }
  let bits = 0,
    carry = 0,
    at = 0,
    previous = 0,
    entry = 0,
    advance = 0;
  for (let pos = start; pos < text.length; pos++) {
    const c = text.charCodeAt(pos);
    if (!wide && c >= 2048) throw Error("Invalid payload character");
    entry = model[(bits << (wide ? 16 : 11)) + c];
    if (!entry) throw Error("Invalid payload character");
    out[at] = ((entry & 255) | (carry << (8 - bits))) ^ mask;
    out[at + 1] = (entry >>> 8) ^ mask;
    advance = (entry >>> 16) & 3;
    at += advance;
    previous = bits;
    bits = (entry >>> 18) & 7;
    carry = (entry >>> 21) & 127;
  }
  const padding = at * 8 + bits - length * 8,
    width = advance * 8 + bits - previous;
  if (padding < 0) throw Error("Invalid payload length");
  if (
    (text.length > start && padding >= width) ||
    carry ||
    (at > length && (entry >>> 8) & 255)
  )
    throw Error("Invalid payload padding");
  return out;
}

const encoder = /* @__PURE__ */ new TextEncoder();
export function byteInput(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    input = encoder.encode(text);
  let q = 0,
    bits = 0,
    at = 0,
    last = 0;
  for (let pos = start; pos < input.length; pos++) {
    let c = input[pos];
    if (c >= 128) {
      if (c < 194 || c > 223 || pos + 1 >= input.length)
        throw Error("Invalid payload character");
      c = ((c & 31) << 6) | (input[++pos] & 63);
    }
    const e = table[c];
    if (!e) throw Error("Invalid payload character");
    if (c < 128) {
      last = 7;
      if (bits === 0) {
        q = c;
        bits = 7;
      } else {
        q = (q << 7) | c;
        bits--;
        out[at++] = (q >>> bits) ^ mask;
      }
    } else {
      const w = e >>> 16;
      q = (q << w) | (e & 32767);
      bits += w - 8;
      last = w;
      out[at++] = (q >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (q >>> bits) ^ mask;
      }
    }
  }
  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  if ((text.length > start && padding >= last) || q & ((1 << padding) - 1))
    throw Error("Invalid payload padding");
  return out;
}

const fullCache = /* @__PURE__ */ new WeakMap();

export function bounded(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    end = text.length;
  let queue = 0,
    bits = 0,
    at = 0,
    lastWidth = 0;
  for (let pos = start; pos < end; pos++) {
    const c = text.charCodeAt(pos),
      entry = c < 2048 ? table[c] : 0;
    if (!entry) throw Error("Invalid payload character");
    if (c < 128) {
      lastWidth = 7;
      // Seven bits emit no byte only when the previous queue was empty.
      // Otherwise exactly one byte is ready and its new shift is oldShift-1.
      if (bits === 0) {
        queue = c;
        bits = 7;
      } else {
        queue = (queue << 7) | c;
        bits--;
        out[at++] = (queue >>> bits) ^ mask;
      }
    } else {
      // Wide symbols contribute 14/15 bits, so the first byte is always ready.
      // With fewer than eight carried bits there can be at most two bytes.
      const width = entry >>> 16;
      queue = (queue << width) | (entry & 32767);
      bits += width - 8;
      lastWidth = width;
      out[at++] = (queue >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (queue >>> bits) ^ mask;
      }
    }
  }

  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  // Zero padding belongs only to the final symbol. The first condition rejects
  // redundant symbols and also bounds padding below 15 before the JS shift.
  // Typed-array writes beyond the declared length were ignored; these low
  // bits still contain every such padding bit and must all be zero.
  if ((end > start && padding >= lastWidth) || queue & ((1 << padding) - 1))
    throw Error("Invalid payload padding");
  return out;
}

export function asciiPairs(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    end = text.length;
  let queue = 0,
    bits = 0,
    at = 0,
    lastWidth = 0;
  for (let pos = start; pos < end; pos++) {
    if (pos + 1 < end) {
      const a = text.charCodeAt(pos),
        b = text.charCodeAt(pos + 1);
      if ((a | b) < 128) {
        if (!(table[a] & table[b] & 65536))
          throw Error("Invalid payload character");
        queue = (queue << 14) | (a << 7) | b;
        bits += 6;
        lastWidth = 7;
        out[at++] = (queue >>> bits) ^ mask;
        if (bits >= 8) {
          bits -= 8;
          out[at++] = (queue >>> bits) ^ mask;
        }
        pos++;
        continue;
      }
    }
    const c = text.charCodeAt(pos),
      entry = table[c];
    if (!entry) throw Error("Invalid payload character");
    if (c < 128) {
      lastWidth = 7;
      // Seven bits emit no byte only when the previous queue was empty.
      // Otherwise exactly one byte is ready and its new shift is oldShift-1.
      if (bits === 0) {
        queue = c;
        bits = 7;
      } else {
        queue = (queue << 7) | c;
        bits--;
        out[at++] = (queue >>> bits) ^ mask;
      }
    } else {
      // Wide symbols contribute 14/15 bits, so the first byte is always ready.
      // With fewer than eight carried bits there can be at most two bytes.
      const width = entry >>> 16;
      queue = (queue << width) | (entry & 32767);
      bits += width - 8;
      lastWidth = width;
      out[at++] = (queue >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (queue >>> bits) ^ mask;
      }
    }
  }

  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  // Zero padding belongs only to the final symbol. The first condition rejects
  // redundant symbols and also bounds padding below 15 before the JS shift.
  // Typed-array writes beyond the declared length were ignored; these low
  // bits still contain every such padding bit and must all be zero.
  if ((end > start && padding >= lastWidth) || queue & ((1 << padding) - 1))
    throw Error("Invalid payload padding");
  return out;
}

export function fullTable(text) {
  const { table: original, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    end = text.length;
  let table = fullCache.get(original);
  if (!table) {
    table = new Uint32Array(65536);
    table.set(original);
    fullCache.set(original, table);
  }
  let queue = 0,
    bits = 0,
    at = 0,
    lastWidth = 0;
  for (let pos = start; pos < end; pos++) {
    const c = text.charCodeAt(pos),
      entry = table[c];
    if (!entry) throw Error("Invalid payload character");
    if (c < 128) {
      lastWidth = 7;
      // Seven bits emit no byte only when the previous queue was empty.
      // Otherwise exactly one byte is ready and its new shift is oldShift-1.
      if (bits === 0) {
        queue = c;
        bits = 7;
      } else {
        queue = (queue << 7) | c;
        bits--;
        out[at++] = (queue >>> bits) ^ mask;
      }
    } else {
      // Wide symbols contribute 14/15 bits, so the first byte is always ready.
      // With fewer than eight carried bits there can be at most two bytes.
      const width = entry >>> 16;
      queue = (queue << width) | (entry & 32767);
      bits += width - 8;
      lastWidth = width;
      out[at++] = (queue >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (queue >>> bits) ^ mask;
      }
    }
  }

  const padding = at * 8 + bits - length * 8;
  if (padding < 0) throw Error("Invalid payload length");
  // Zero padding belongs only to the final symbol. The first condition rejects
  // redundant symbols and also bounds padding below 15 before the JS shift.
  // Typed-array writes beyond the declared length were ignored; these low
  // bits still contain every such padding bit and must all be zero.
  if ((end > start && padding >= lastWidth) || queue & ((1 << padding) - 1))
    throw Error("Invalid payload padding");
  return out;
}

export function asciiSpec(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    end = text.length;
  let queue = 0,
    bits = 0,
    at = 0,
    lastWidth = 0;
  for (let pos = start; pos < end; pos++) {
    const c = text.charCodeAt(pos),
      entry = table[c];
    if (!entry) fail(3);
    if (c < 128) {
      lastWidth = 7;
      // Seven bits emit no byte only when the previous queue was empty.
      // Otherwise exactly one byte is ready and its new shift is oldShift-1.
      queue = (queue << 7) | c;
      const total = bits + 7;
      bits = total & 7;
      out[at] = (queue >>> bits) ^ mask;
      at += total >>> 3;
    } else {
      // Wide symbols contribute 14/15 bits, so the first byte is always ready.
      // With fewer than eight carried bits there can be at most two bytes.
      const width = entry >>> 16;
      queue = (queue << width) | (entry & 32767);
      bits += width - 8;
      lastWidth = width;
      out[at++] = (queue >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (queue >>> bits) ^ mask;
      }
    }
  }

  const padding = at * 8 + bits - length * 8;
  if (padding < 0) fail(2);
  // Zero padding belongs only to the final symbol. The first condition rejects
  // redundant symbols and also bounds padding below 15 before the JS shift.
  // Typed-array writes beyond the declared length were ignored; these low
  // bits still contain every such padding bit and must all be zero.
  if ((end > start && padding >= lastWidth) || queue & ((1 << padding) - 1))
    fail(4);
  return out;
}

export function asciiConditional(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length),
    end = text.length;
  let queue = 0,
    bits = 0,
    at = 0,
    lastWidth = 0;
  for (let pos = start; pos < end; pos++) {
    const c = text.charCodeAt(pos),
      entry = table[c];
    if (!entry) fail(3);
    if (c < 128) {
      lastWidth = 7;
      // Seven bits emit no byte only when the previous queue was empty.
      // Otherwise exactly one byte is ready and its new shift is oldShift-1.
      queue = (queue << 7) | c;
      const total = bits + 7;
      bits = total & 7;
      if (total >= 8) out[at++] = (queue >>> bits) ^ mask;
    } else {
      // Wide symbols contribute 14/15 bits, so the first byte is always ready.
      // With fewer than eight carried bits there can be at most two bytes.
      const width = entry >>> 16;
      queue = (queue << width) | (entry & 32767);
      bits += width - 8;
      lastWidth = width;
      out[at++] = (queue >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (queue >>> bits) ^ mask;
      }
    }
  }

  const padding = at * 8 + bits - length * 8;
  if (padding < 0) fail(2);
  // Zero padding belongs only to the final symbol. The first condition rejects
  // redundant symbols and also bounds padding below 15 before the JS shift.
  // Typed-array writes beyond the declared length were ignored; these low
  // bits still contain every such padding bit and must all be zero.
  if ((end > start && padding >= lastWidth) || queue & ((1 << padding) - 1))
    fail(4);
  return out;
}
