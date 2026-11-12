// Streaming alternative to the exact block enumerator. Interpret source bytes
// as the prefix of an arithmetic-coded bitstream; decode that stream into UTF-8
// symbols. The browser performs the inverse (arithmetic encoding).
import { capacity, modelFor, pointFor, protect } from './codec.mjs';

const TOTAL = 1048576; // 2^20: all products below 2^53, exact in JS Number.
const HALF = 2147483648, QUARTER = 1073741824, THREE_QUARTERS = 3221225472;

export function distribution(profile = 'utf8-data') {
  const { counts, lambda } = capacity(profile);
  const cdf = [0];
  let cumulative = 0;
  for (let w = 1; w <= 4; w++) {
    cumulative += counts[w - 1] / lambda ** w;
    cdf.push(w === 4 ? TOTAL : Math.round(cumulative * TOTAL));
  }
  return cdf;
}

export function arithmeticEncode(input, { profile = 'utf8-data' } = {}) {
  const m = modelFor(profile, 1), cdf = distribution(profile);
  let low = 0, high = 4294967295, value = 0, bitPos = 0;
  let emitted = 0, pending = 0;
  const nbits = input.byteLength * 8, chars = [];
  // Use the MIDPOINT of the dyadic interval for the input. An all-zero tail
  // would put us on its boundary and could prevent termination.
  function readBit() {
    const p = bitPos++;
    if (p < nbits) return input[Math.floor(p / 8)] >> (7 - (p & 7)) & 1;
    return p === nbits ? 1 : 0;
  }
  for (let i = 0; i < 32; i++) value = value * 2 + readBit();
  while (emitted < nbits) {
    const range = high - low + 1;
    let w = 1;
    while (w < 4 && value >= low + Math.floor(range * cdf[w] / TOTAL)) w++;
    const groupLow = low + Math.floor(range * cdf[w - 1] / TOTAL);
    const groupHigh = low + Math.floor(range * cdf[w] / TOTAL) - 1;
    const groupRange = groupHigh - groupLow + 1, count = m.counts[w - 1];
    const digit = Math.floor(((value - groupLow + 1) * count - 1) / groupRange);
    low = groupLow + Math.floor(groupRange * digit / count);
    high = groupLow + Math.floor(groupRange * (digit + 1) / count) - 1;
    if (value < low || value > high || low > high) throw Error('Arithmetic interval');
    chars.push(String.fromCodePoint(pointFor(digit, w, m)));
    while (true) {
      if (high < HALF) { emitted += pending + 1; pending = 0; }
      else if (low >= HALF) {
        emitted += pending + 1; pending = 0;
        low -= HALF; high -= HALF; value -= HALF;
      } else if (low >= QUARTER && high < THREE_QUARTERS) {
        pending++; low -= QUARTER; high -= QUARTER; value -= QUARTER;
      } else break;
      low *= 2; high = high * 2 + 1; value = value * 2 + readBit();
    }
  }
  return protect(chars.join(''));
}

// This is also the complete browser implementation; no module imports needed.
export function arithmeticDecode(s, n, a, nul, cdf, unicode = true) {
  if (!Number.isSafeInteger(n) || n < 0) throw Error('Length');
  if (nul) s = s.replace(/\ufffd/g, '\0');
  s = s.replace(/<\x01\x01\x01/g, '<');
  let counts = [a.length, unicode ? 1920 : 0,
    unicode ? 61440 - +nul : 0, unicode ? 1048576 : 0];
  let low = 0, high = 4294967295, pending = 0, bits = 0, out = new Uint8Array(n);
  function emit(bit) {
    if (bits < n * 8) out[Math.floor(bits / 8)] |= bit << (7 - (bits & 7));
    bits++;
  }
  for (const ch of s) {
    if (bits >= n * 8) throw Error('Trailing');
    let cp = ch.codePointAt(0), w, d;
    if (cp < 128) { w = 1; d = a.indexOf(cp); }
    else if (cp < 2048) { w = 2; d = cp - 128; }
    else if (cp > 65535) { w = 4; d = cp - 65536; }
    else {
      w = 3;
      d = cp - 2048 - (cp >= 57344 ? 2048 : 0) - (nul && cp > 65533 ? 1 : 0);
      if (cp >= 55296 && cp < 57344 || nul && cp === 65533) d = -1;
    }
    if (d < 0 || d >= counts[w - 1]) throw Error('Symbol');
    let range = high - low + 1;
    let groupLow = low + Math.floor(range * cdf[w - 1] / 1048576);
    let groupHigh = low + Math.floor(range * cdf[w] / 1048576) - 1;
    let groupRange = groupHigh - groupLow + 1;
    low = groupLow + Math.floor(groupRange * d / counts[w - 1]);
    high = groupLow + Math.floor(groupRange * (d + 1) / counts[w - 1]) - 1;
    if (low > high) throw Error('Interval');
    while (true) {
      let bit;
      if (high < 2147483648) bit = 0;
      else if (low >= 2147483648) { bit = 1; low -= 2147483648; high -= 2147483648; }
      else if (low >= 1073741824 && high < 3221225472) {
        pending++; low -= 1073741824; high -= 1073741824;
        low *= 2; high = high * 2 + 1;
        continue;
      } else break;
      emit(bit);
      while (pending) { emit(1 - bit); pending--; }
      low *= 2; high = high * 2 + 1;
    }
  }
  if (bits < n * 8) throw Error('Truncated');
  return out;
}

export function decodeArithmetic(s, n, { profile = 'utf8-data' } = {}) {
  const m = modelFor(profile, 1);
  return arithmeticDecode(s, n, m.alphabet, m.p.nul, distribution(profile), m.p.unicode);
}

export function makeArithmeticHTML(input, { profile = 'utf8-data', tail = '',
  payload = undefined, decoder = undefined } = {}) {
  const m = modelFor(profile, 1), encoded = payload ?? arithmeticEncode(input, { profile });
  const a = `Array.from({length:128},(_,i)=>i).filter(i=>i!==13${
    m.p.nul ? '' : '&&i!==0'}${m.p.template ? '&&i!==92&&i!==96' : ''})`;
  const args = `,${input.byteLength},${a},${+m.p.nul},${JSON.stringify(distribution(profile))},${+m.p.unicode})`;
  const source = '(' + (decoder ?? arithmeticDecode.toString().replace(/\s+/g, ' ')) + ')';
  let html;
  if (m.p.template) {
    html = '<meta charset=utf-8><script>globalThis.unpacked=' + source + '(`' +
      encoded.replace(/\$\{/g, '\\${') + '`' + args + ';' + tail + '</script>';
  } else {
    html = '<meta charset=utf-8><script type=x id=p>' + encoded +
      '</script><script>globalThis.unpacked=' + source +
      '(document.getElementById("p").textContent' + args + ';' + tail + '</script>';
  }
  return { html, encoded, payloadBytes: new TextEncoder().encode(encoded).length };
}

