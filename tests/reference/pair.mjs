/* 0BSD, NeoX. Independent current-format pair oracle. BigInt is used only in
 * tests, providing a different queue representation from the native kernel. */
import { xxhash32 } from "./decoder/xxhash32.js";
import { createBlake3 } from "./decoder/blake3.js";
const alphabet = [];
for (let c = 32; c < 65534; c++)
  if (
    !(
      c === 60 ||
      (c >= 127 && c <= 159) ||
      (c >= 55296 && c <= 57343) ||
      (c >= 64976 && c <= 65007) ||
      [65279, 8232, 8233].includes(c)
    )
  )
    alphabet.push(c);
const table = new Uint16Array(65536);
alphabet.forEach((c, i) => (table[c] = i + 1));
const R = alphabet.length,
  T = R * R - 2147483649,
  hash = createBlake3();
export function binary(
  text,
  { verifyFormat = true, verifyData = "secure" } = {},
) {
  const fail = (m) => {
      throw Error(m);
    },
    lengthError = () => fail("Invalid payload length");
  if (text.length < 2) lengthError();
  if (text.charCodeAt(0) !== 9) fail("Unsupported payload codec");
  const digit = (i) => {
    const n = table[text.charCodeAt(i)];
    if (!n) fail("Invalid payload character");
    return n - 1;
  };
  const first = digit(1),
    settings = first & 1023,
    kind = settings >>> 8,
    mask = settings & 255;
  let at = 3,
    length;
  if (first < 32768) length = (first >>> 10) * R + digit(2);
  else {
    if (first >= 33792) fail("Invalid payload header");
    if (text.length < 4) lengthError();
    length = digit(2) + R * digit(3);
    at = 4;
    if (length < 32 * R) fail("Invalid payload header");
  }
  const trailer = kind === 1 ? 4 : kind === 2 ? 32 : 0,
    requested =
      verifyData === "none" || verifyData === false
        ? 0
        : verifyData === "fast"
          ? 1
          : 2;
  if (
    !Number.isSafeInteger(length) ||
    length < trailer ||
    length > (text.length - at) * 2 ||
    (text.length - at) % 2 ||
    kind === 3
  )
    lengthError();
  if (requested && requested !== kind)
    fail("Required payload integrity mode missing");
  const bytes = new Uint8Array(length);
  let queue = 0n,
    bits = 0,
    written = 0;
  for (; at < text.length; at += 2) {
    const v = digit(at) + R * digit(at + 1),
      width = (v & 0x7fffffff) > T ? 31 : 32;
    queue |= BigInt(v) << BigInt(bits);
    bits += width;
    while (bits >= 8) {
      if (written < length) bytes[written] = Number(queue & 255n) ^ mask;
      written++;
      queue >>= 8n;
      bits -= 8;
    }
  }
  if (written < length) lengthError();
  if (verifyFormat && (queue !== 0n || written > length)) {
    // A final pair carries zero transport padding beyond the declared bytes.
    // Check byte padding by decoding only its unmasked values above, before XOR.
    if (queue !== 0n) fail("Invalid payload padding");
  }
  const end = length - trailer;
  if (
    requested === 1 &&
    xxhash32(bytes, end) !== new DataView(bytes.buffer).getUint32(end, true)
  )
    fail("Payload checksum mismatch");
  if (requested === 2) {
    const digest = hash(bytes, end);
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= digest[i] ^ bytes[end + i];
    if (diff) fail("Payload digest mismatch");
  }
  return trailer ? bytes.subarray(0, end) : bytes;
}
