/* 0BSD, NeoX. Independent experiment implementing the browser optimizations
 * described in the supplied report. This is NOT the missing optimized source
 * referred to by that report, and is not a production GlyphPack format. */
export function decodeDenseBrowser(text, length) {
  // A Unicode symbol commits at most 32 bits here. Keep allocation proportional
  // to supplied text even in this benchmark-only decoder, before allocating.
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > 0x40000000 ||
    length > text.length * 4
  )
    throw Error("Length");
  const out = new Uint8Array(length),
    total = length * 8;
  let low = 0,
    high = 0xffffffff,
    pending = 0,
    bits = 0;
  for (let pos = 0; pos < text.length; ) {
    if (bits >= total) throw Error("Trailing");
    let cp = text.charCodeAt(pos++);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const tail = text.charCodeAt(pos++);
      if (!(tail >= 0xdc00 && tail <= 0xdfff)) throw Error("Symbol");
      cp = 0x10000 + (cp - 0xd800) * 1024 + tail - 0xdc00;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) throw Error("Symbol");
    // HTML substitutes U+FFFD for a source NUL. The dense alphabet reserves
    // literal U+FFFD, so reversing that substitution is unambiguous.
    if (cp === 0xfffd) cp = 0;
    // Remove one guard only. A natural <+guard was doubled by protect().
    if (
      cp === 60 &&
      text.charCodeAt(pos) === 1 &&
      text.charCodeAt(pos + 1) === 1 &&
      text.charCodeAt(pos + 2) === 1
    )
      pos += 3;
    const range = high - low + 1;
    let digit, count, groupLow, groupRange;
    if (cp < 128) {
      if (cp === 13) throw Error("Symbol");
      digit = cp - (cp > 13);
      count = 127;
      groupLow = low;
      groupRange = Math.floor((range * 926774) / 1048576);
    } else {
      let lower, upper;
      if (cp < 2048) {
        digit = cp - 128;
        count = 1920;
        lower = 926774;
        upper = 1024282;
      } else if (cp < 65536) {
        digit = cp - 2048 - (cp >= 0xe000 ? 2048 : 0) - (cp > 0xfffd);
        count = 61439;
        lower = 1024282;
        upper = 1045997;
      } else {
        digit = cp - 65536;
        count = 1048576;
        lower = 1045997;
        upper = 1048576;
      }
      groupLow = low + Math.floor((range * lower) / 1048576);
      groupRange =
        Math.floor((range * upper) / 1048576) -
        Math.floor((range * lower) / 1048576);
    }
    low = groupLow + Math.floor((groupRange * digit) / count);
    high = groupLow + Math.floor((groupRange * (digit + 1)) / count) - 1;
    if (low > high) throw Error("Interval");
    for (;;) {
      let bit;
      if (high < 0x80000000) bit = 0;
      else if (low >= 0x80000000) {
        bit = 1;
        low -= 0x80000000;
        high -= 0x80000000;
      } else if (low >= 0x40000000 && high < 0xc0000000) {
        pending++;
        low -= 0x40000000;
        high -= 0x40000000;
        low = (low << 1) >>> 0;
        high = ((high << 1) | 1) >>> 0;
        continue;
      } else break;
      // Output starts at zero; committing a zero needs no memory write.
      if (bit && bits < total) out[Math.floor(bits / 8)] |= 128 >>> (bits & 7);
      bits++;
      if (!bit && pending) {
        // A pending complement run after zero consists entirely of ones.
        // Write at most a byte at a time, including partial boundary bytes.
        let at = bits,
          end = Math.min(total, bits + pending);
        while (at < end) {
          const take = Math.min(8 - (at & 7), end - at);
          out[Math.floor(at / 8)] |= ((1 << take) - 1) << (8 - (at & 7) - take);
          at += take;
        }
      }
      bits += pending;
      pending = 0;
      low = (low << 1) >>> 0;
      high = ((high << 1) | 1) >>> 0;
    }
  }
  if (bits < total) throw Error("Truncated");
  return out;
}
