/* 0BSD, NeoX. Fast UTF-8 transport experiment. The alphabet uses ASCII and
 * U+00A0..U+07FF only; forbidden ASCII prefixes gain an extra payload bit.
 * This raw transport has no integrity digest. It is not the production wire API. */
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const portableOnly =
  typeof PREFIX_PORTABLE_ONLY !== "undefined" && PREFIX_PORTABLE_ONLY;
// Profiles 0..4 screen progressively stricter ASCII sets. Profile 5 also uses
// a frozen, assigned, NFC-stable two-byte alphabet without marks or format
// characters. This build define removes unselected profiles from delivered JS.
const profiles = portableOnly
  ? { 5: [0, 10, 13, 34, 36, 39, 60, 92, 96, 127] }
  : [
      [0, 10, 13, 34, 38, 60, 92],
      [0, 10, 13, 34, 38, 60, 92, 127],
      [0, 10, 13, 34, 38, 60, 92, 96, 127],
      [0, 10, 13, 34, 38, 39, 60, 92, 96, 127],
      [0, 10, 13, 34, 36, 38, 39, 60, 92, 96, 127],
      [0, 10, 13, 34, 36, 39, 60, 92, 96, 127],
    ];
// Half-open ranges, frozen as part of version 1. Do not regenerate from the
// host Unicode version: adding code points would change every subsequent digit.
const portableRanges = [
  [160, 173],
  [174, 768],
  [880, 884],
  [885, 888],
  [890, 894],
  [895, 896],
  [900, 903],
  [904, 907],
  [908, 909],
  [910, 930],
  [931, 1155],
  [1162, 1328],
  [1329, 1367],
  [1369, 1419],
  [1421, 1424],
  [1470, 1471],
  [1472, 1473],
  [1475, 1476],
  [1478, 1479],
  [1488, 1515],
  [1519, 1525],
  [1542, 1552],
  [1563, 1564],
  [1565, 1611],
  [1632, 1648],
  [1649, 1750],
  [1758, 1759],
  [1765, 1767],
  [1769, 1770],
  [1774, 1806],
  [1808, 1809],
  [1810, 1840],
  [1869, 1958],
  [1969, 1970],
  [1984, 2027],
  [2036, 2043],
  [2046, 2048],
];
const caches = [];
export function warmup(profile = 5) {
  if (!Number.isInteger(profile) || profile < 0 || !profiles[profile])
    throw Error("Unsupported UTF-8 profile");
  if (caches[profile]) return;
  const forbidden = profiles[profile],
    radix = Math.min(
      256,
      Math.floor(
        (portableOnly || profile === 5 ? 1547 : 1888) / forbidden.length,
      ),
    );
  const base = Math.floor(Math.log2(radix)),
    cut = 2 ** (base + 1) - radix;
  // Truncated binary gives each escape class radix distinct tails. Some tails
  // consume seven bits, the rest eight; ASCII always consumes seven. Each
  // nonzero table entry stores its 7/14/15-bit width above the decoded value.
  const table = new Uint32Array(2048);
  for (let c = 1; c < 128; c++)
    if (!forbidden.includes(c)) table[c] = c | (7 << 16);
  let ordinal = 0;
  for (const [start, end] of portableOnly || profile === 5
    ? portableRanges
    : [[160, 2048]])
    for (let c = start; c < end; c++) {
      if (ordinal >= forbidden.length * radix) break;
      const digit = ordinal % radix,
        first = forbidden[Math.floor(ordinal / radix)],
        width = digit < cut ? base : base + 1,
        tail = digit < cut ? digit : digit + cut;
      table[c] = (first << width) | tail | ((7 + width) << 16);
      ordinal++;
    }
  caches[profile] = { table };
}
export function prepare(text) {
  if (text.slice(0, 3) !== "~u1" || text.length < 7)
    throw Error("Invalid UTF-8 header");
  const profile = alphabet.indexOf(text[3]);
  if (profile < 0 || !profiles[profile])
    throw Error("Unsupported UTF-8 profile");
  const a = alphabet.indexOf(text[4]),
    b = alphabet.indexOf(text[5]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  const mask = a | (b << 6);
  let start = 6,
    length = 0,
    power = 1,
    digit;
  do {
    if (start >= text.length || power > 0x40000000)
      throw Error("Invalid payload length");
    digit = alphabet.indexOf(text[start++]);
    if (digit < 0) throw Error("Invalid UTF-8 header");
    length += (digit & 31) * power;
    power *= 32;
  } while (digit & 32);
  // These allocation bounds apply even to trusted data. A short header cannot
  // reserve output disproportionate to the maximum 15 bits per body character.
  if (
    !Number.isSafeInteger(length) ||
    length > 0x40000000 ||
    length > Math.floor(((text.length - start) * 15) / 8)
  )
    throw Error("Invalid payload length");
  if (power > 32 && !(digit & 31)) throw Error("Invalid UTF-8 header");
  warmup(profile);
  return { ...caches[profile], mask, length, start };
}
export function binary(text) {
  const { table, mask, length, start } = prepare(text),
    out = new Uint8Array(length);
  let queue = 0,
    bits = 0,
    at = 0;
  for (let pos = start; pos < text.length; pos++) {
    if (at >= length) throw Error("Invalid payload padding");
    const entry = table[text.charCodeAt(pos)];
    if (!entry) throw Error("Invalid payload character");
    const width = entry >>> 16;
    queue = (queue << width) | (entry & 32767);
    bits += width;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (queue >>> bits) ^ mask;
      if (bits >= 8) {
        bits -= 8;
        const value = (queue >>> bits) & 255;
        if (at < length) out[at++] = value ^ mask;
        else if (value) throw Error("Invalid payload padding");
      }
    }
  }
  if (at !== length) throw Error("Invalid payload length");
  if (queue & ((1 << bits) - 1)) throw Error("Invalid payload padding");
  return out;
}
