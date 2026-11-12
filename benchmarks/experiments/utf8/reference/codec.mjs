// Enumerative coding of valid UTF-8 by ON-DISK byte cost, not character count.
// No dependencies. The readable decoder is also embedded into generated HTML.
export const profiles = {
  'utf8-data': { unicode: true, template: false, nul: true },
  'utf8-template': { unicode: true, template: true, nul: true },
  'utf8-clean': { unicode: true, template: false, nul: false },
  'ascii-data': { unicode: false, template: false, nul: true },
};

const models = new Map();
const guard = '\x01\x01\x01';

export function modelFor(profile = 'utf8-data', blockSize = 4096) {
  if (!profiles[profile]) throw Error('Unknown profile: ' + profile);
  if (!Number.isSafeInteger(blockSize) || blockSize < 1 || blockSize > 16384)
    throw Error('blockSize must be an integer in 1..16384');
  const key = profile + ':' + blockSize;
  if (models.has(key)) return models.get(key);
  const p = profiles[profile];
  // CR is folded to LF by HTML. NUL becomes U+FFFD; reserve that code point
  // and reverse the substitution in the decoder to retain the cheap NUL slot.
  const alphabet = Array.from({ length: 128 }, (_, c) => c).filter(c =>
    c !== 13 && (p.nul || c !== 0) && (!p.template || (c !== 92 && c !== 96)));
  const counts = [alphabet.length, p.unicode ? 1920 : 0,
    p.unicode ? 61440 - Number(p.nul) : 0, p.unicode ? 1048576 : 0];
  const t = [1n];
  const target = 1n << BigInt(blockSize * 8);
  while (t.at(-1) < target) {
    const n = t.length;
    let total = 0n;
    for (let w = 1; w <= 4 && w <= n; w++)
      total += BigInt(counts[w - 1]) * t[n - w];
    t.push(total);
  }
  const lengths = new Map([[0, 0], [blockSize, t.length - 1]]);
  function lengthFor(n) {
    if (lengths.has(n)) return lengths.get(n);
    const goal = 1n << BigInt(n * 8);
    let lo = 0, hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < goal) lo = mid + 1;
      else hi = mid;
    }
    lengths.set(n, lo);
    return lo;
  }
  const model = { p, alphabet, counts, t, lengthFor, blockSize };
  models.set(key, model);
  return model;
}

export function pointFor(d, w, m) {
  if (w === 1) return m.alphabet[d];
  if (w === 2) return d + 128;
  if (w === 4) return d + 65536;
  let cp = d + 2048;
  if (cp >= 0xd800) cp += 2048;
  if (m.p.nul && cp >= 0xfffd) cp++;
  return cp;
}

export function digitFor(cp, m) {
  if (cp < 128) return [m.alphabet.indexOf(cp), 1];
  if (cp < 2048) return [cp - 128, 2];
  if (cp >= 65536) return [cp - 65536, 4];
  if (cp >= 0xd800 && cp < 0xe000 || m.p.nul && cp === 0xfffd)
    return [-1, 3];
  return [cp - 2048 - (cp >= 0xe000 ? 2048 : 0) -
    (m.p.nul && cp > 0xfffd ? 1 : 0), 3];
}

// Guard both HTML's closing script tag and its legacy <!-- escaped state.
// Also double naturally occurring guard prefixes to make the transform bijective.
export function protect(s) {
  return s.replace(/<(?=\/script|!--|\x01\x01\x01)/gi, '<' + guard);
}

export function encode(input, { profile = 'utf8-data', blockSize = 4096 } = {}) {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const m = modelFor(profile, blockSize), pieces = [];
  for (let start = 0; start < bytes.length; start += blockSize) {
    const block = bytes.subarray(start, start + blockSize);
    const hex = Array.from(block, b => b.toString(16).padStart(2, '0')).join('');
    let rank = BigInt('0x' + hex), remaining = m.lengthFor(block.length);
    const chars = [];
    while (remaining) {
      let w = 1;
      for (; w <= 4 && w <= remaining; w++) {
        const weight = m.t[remaining - w];
        const size = BigInt(m.counts[w - 1]) * weight;
        if (rank < size) {
          const digit = Number(rank / weight);
          rank %= weight;
          chars.push(String.fromCodePoint(pointFor(digit, w, m)));
          break;
        }
        rank -= size;
      }
      if (w > 4 || w > remaining) throw Error('Internal rank overflow');
      remaining -= w;
    }
    pieces.push(chars.join(''));
  }
  return protect(pieces.join(''));
}

export function decode(s, byteLength, { profile = 'utf8-data', blockSize = 4096 } = {}) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw Error('Invalid length');
  const m = modelFor(profile, blockSize);
  if (m.p.nul) s = s.replace(/\ufffd/g, '\0');
  s = s.replace(/<\x01\x01\x01/g, '<');
  const result = new Uint8Array(byteLength);
  let pos = 0;
  for (let start = 0; start < byteLength; start += blockSize) {
    const size = Math.min(blockSize, byteLength - start);
    let remaining = m.lengthFor(size), rank = 0n;
    while (remaining) {
      if (pos >= s.length) throw Error('Truncated payload');
      const cp = s.codePointAt(pos);
      pos += cp >= 65536 ? 2 : 1;
      const [digit, w] = digitFor(cp, m);
      if (digit < 0 || digit >= m.counts[w - 1] || w > remaining)
        throw Error('Invalid payload symbol');
      for (let j = 1; j < w; j++)
        rank += BigInt(m.counts[j - 1]) * m.t[remaining - j];
      remaining -= w;
      rank += BigInt(digit) * m.t[remaining];
    }
    if (rank >= 1n << BigInt(size * 8)) throw Error('Unused codeword');
    const hex = rank.toString(16).padStart(size * 2, '0');
    for (let i = 0; i < size; i++)
      result[start + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (pos !== s.length) throw Error('Trailing payload');
  return result;
}

// Standalone browser decoder. Deliberately self-contained for serialization.
// Readable formatting is stripped only when producing the measured artifact.
export function browserDecode(s, n, k, a, nul, unicode) {
  if (nul) s = s.replace(/\ufffd/g, '\0');
  s = s.replace(/<\x01\x01\x01/g, '<');
  let c = [a.length, unicode ? 1920 : 0, unicode ? 61440 - +nul : 0,
    unicode ? 1048576 : 0], t = [1n], goal = 1n << BigInt(k * 8);
  while (t[t.length - 1] < goal) {
    let v = 0n, r = t.length;
    for (let w = 1; w <= 4 && w <= r; w++) v += BigInt(c[w - 1]) * t[r - w];
    t.push(v);
  }
  let out = new Uint8Array(n), p = 0;
  for (let start = 0; start < n; start += k) {
    let size = Math.min(k, n - start), target = 1n << BigInt(size * 8);
    let r = 0, rank = 0n;
    while (t[r] < target) r++;
    while (r) {
      if (p >= s.length) throw Error('Truncated');
      let cp = s.codePointAt(p), w, d;
      p += cp > 65535 ? 2 : 1;
      if (cp < 128) { w = 1; d = a.indexOf(cp); }
      else if (cp < 2048) { w = 2; d = cp - 128; }
      else if (cp > 65535) { w = 4; d = cp - 65536; }
      else {
        w = 3;
        d = cp - 2048 - (cp >= 57344 ? 2048 : 0) - (nul && cp > 65533 ? 1 : 0);
        if (cp >= 55296 && cp < 57344 || nul && cp === 65533) d = -1;
      }
      if (w > r || d < 0 || d >= c[w - 1]) throw Error('Symbol');
      for (let j = 1; j < w; j++) rank += BigInt(c[j - 1]) * t[r - j];
      r -= w;
      rank += BigInt(d) * t[r];
    }
    if (rank >= target) throw Error('Codeword');
    let h = rank.toString(16).padStart(size * 2, '0');
    for (let i = 0; i < size; i++) out[start + i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  if (p !== s.length) throw Error('Trailing');
  return out;
}

export function decoderSource() {
  // These functions contain no line comments/strings with significant spaces.
  return browserDecode.toString().replace(/\s+/g, ' ');
}

export function makeHTML(input, { profile = 'utf8-data', blockSize = 4096,
  tail = '', payload = undefined, decoder = decoderSource() } = {}) {
  const m = modelFor(profile, blockSize);
  const encoded = payload ?? encode(input, { profile, blockSize });
  const alphabetSource = `Array.from({length:128},(_,i)=>i).filter(i=>i!==13${
    m.p.nul ? '' : '&&i!==0'}${m.p.template ? '&&i!==92&&i!==96' : ''})`;
  const args = `,${input.byteLength},${blockSize},${alphabetSource},${+m.p.nul},${+m.p.unicode})`;
  const decodeFunction = `(${decoder})`;
  let html;
  if (m.p.template) {
    // Cooked templates turn this escape back into the original ${ sequence.
    const literal = encoded.replace(/\$\{/g, '\\${');
    html = '<meta charset=utf-8><script>globalThis.unpacked=' + decodeFunction + '(`' +
      literal + '`' + args + ';' + tail + '</script>';
  } else {
    html = '<meta charset=utf-8><script type=x id=p>' + encoded +
      '</script><script>globalThis.unpacked=' + decodeFunction +
      '(document.getElementById("p").textContent' + args + ';' + tail + '</script>';
  }
  return { html, encoded, payloadBytes: new TextEncoder().encode(encoded).length };
}

export function capacity(profile = 'utf8-data') {
  const { counts } = modelFor(profile, 1);
  let lo = 1, hi = 256;
  for (let i = 0; i < 100; i++) {
    const x = (lo + hi) / 2;
    const sum = counts.reduce((s, c, j) => s + c / x ** (j + 1), 0);
    if (sum > 1) lo = x; else hi = x;
  }
  const lambda = (lo + hi) / 2, bitsPerByte = Math.log2(lambda);
  return { counts, lambda, bitsPerByte, ratio: 8 / bitsPerByte };
}

