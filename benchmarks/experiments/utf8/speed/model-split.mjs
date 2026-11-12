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
// Each pair stores (gap from previous end + 32, range length + 32).
// This delta string is the same frozen 37-range alphabet, not a new wire set.
const portableDeltas =
  '\u00c0-!\u0272\u0090$!#"$!!$#!#!!!4!\u0100\'\u00c6!F"R"#N!!!"!"!);$&1*+!!N50!\u0085(!&""!$@"!!>=y+!.K)\'#"';
const caches = [];
export function fail(code) {
  throw Error(
    [
      "Invalid UTF-8 header",
      "Unsupported UTF-8 profile",
      "Invalid payload length",
      "Invalid payload character",
      "Invalid payload padding",
    ][code],
  );
}
export function warmup(profile = 5) {
  if (!Number.isInteger(profile) || profile < 0 || !profiles[profile]) fail(1);
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
  const table = new Uint16Array(2048),
    widths = new Uint8Array(2048);
  for (let c = 1; c < 128; c++)
    if (!forbidden.includes(c)) {
      table[c] = c;
      widths[c] = 7;
    }
  let ordinal = 0,
    previousEnd = 0;
  const deltas =
    portableOnly || profile === 5 ? portableDeltas : "\u00c0\u0780";
  for (let i = 0; i < deltas.length; i += 2) {
    const start = previousEnd + deltas.charCodeAt(i) - 32;
    const end = start + deltas.charCodeAt(i + 1) - 32;
    previousEnd = end;
    for (let c = start; c < end; c++) {
      if (ordinal >= forbidden.length * radix) break;
      const digit = ordinal % radix,
        first = forbidden[Math.floor(ordinal / radix)],
        width = digit < cut ? base : base + 1,
        tail = digit < cut ? digit : digit + cut;
      table[c] = (first << width) | tail;
      widths[c] = 7 + width;
      ordinal++;
    }
  }
  caches[profile] = { table, widths };
}
export function prepare(text) {
  if (text.slice(0, 3) !== "~u1" || text.length < 7) fail(0);
  const profile = alphabet.indexOf(text[3]);
  if (profile < 0 || !profiles[profile]) fail(1);
  const a = alphabet.indexOf(text[4]),
    b = alphabet.indexOf(text[5]);
  if (a < 0 || b < 0 || b > 3) fail(0);
  const mask = a | (b << 6);
  let start = 6,
    length = 0,
    power = 1,
    digit;
  do {
    if (start >= text.length || power > 0x40000000) fail(2);
    digit = alphabet.indexOf(text[start++]);
    if (digit < 0) fail(0);
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
    fail(2);
  if (power > 32 && !(digit & 31)) fail(0);
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
    if (at >= length) fail(4);
    const entry = table[text.charCodeAt(pos)];
    if (!entry) fail(3);
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
        else if (value) fail(4);
      }
    }
  }
  if (at !== length) fail(2);
  if (queue & ((1 << bits) - 1)) fail(4);
  return out;
}
