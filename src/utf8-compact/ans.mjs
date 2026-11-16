/* 0BSD, NeoX. Small ~c2 header adapter; the measured winner unpacks and verifies
 * directly in the shared Wasm instance. No decoding tables are needed. */
import { failure } from "./wasm-runtime.js";
import { trailerLength } from "./stored.js";
import { protect } from "./compact-guards.mjs";
const digits =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function runAns(api, text, verifyFormat, dataKind) {
  const check = UTF8_FORMAT_RUNTIME ? verifyFormat : UTF8_VERIFY_FORMAT,
    raw = text.replace(/<\x01\x01\x01/g, "<");
  if (check && protect(raw) !== text) throw Error("Invalid payload padding");
  if (raw.length < 15 || raw.slice(2, 5) !== "~c2")
    throw Error("Invalid UTF-8 header");
  const a = digits.indexOf(raw[5]),
    b = digits.indexOf(raw[6]);
  if (a < 0 || b < 0 || b > 3) throw Error("Invalid UTF-8 header");
  let start = 7,
    length = 0,
    power = 1,
    d;
  do {
    if (start >= raw.length || power > 0x40000000) throw failure(2);
    d = digits.indexOf(raw[start++]);
    if (d < 0) throw Error("Invalid UTF-8 header");
    length += (d & 31) * power;
    power *= 32;
  } while (d & 32);
  if (!Number.isSafeInteger(length) || length > 0x40000000) throw failure(2);
  if (power > 32 && !(d & 31)) throw Error("Invalid UTF-8 header");
  let state = 0,
    multiplier = 1;
  for (let i = 0; i < 7; i++) {
    if (start >= raw.length) throw failure(2);
    const value = digits.indexOf(raw[start++]);
    if (value < 0) throw Error("Invalid UTF-8 header");
    state += value * multiplier;
    multiplier *= 64;
  }
  const count = raw.length - start;
  if (state >= 2 ** 38 || length > count * 3) throw failure(2);
  trailerLength(raw.charCodeAt(1) - 48, length, dataKind);
  const pointer = api.input_ptr(count);
  if (!pointer && count) throw failure(8);
  const view = new DataView(api.memory.buffer, pointer, count * 2);
  // Match the existing portable UTF-16 staging. Scalar stores won on random
  // text; the eight-way candidate made only input-dependent small differences.
  for (let i = 0; i < count; i++)
    view.setUint16(i * 2, raw.charCodeAt(start + i), true);
  const status = api.decode_compact(
    length,
    state >>> 0,
    Math.floor(state / 4294967296),
    a | (b << 6),
    raw.charCodeAt(1) - 48,
    dataKind,
    +verifyFormat,
  );
  if (status) throw failure(status);
  const stored = api.stored_len(),
    end = api.payload_len(),
    out = new Uint8Array(stored);
  out.set(new Uint8Array(api.memory.buffer, api.output_ptr(), stored));
  return end === stored ? out : out.subarray(0, end);
}
