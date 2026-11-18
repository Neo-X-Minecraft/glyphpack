/* Thin, synchronous ABI adapter. Native memory and tables remain cached inside
 * the instance; returned bytes always own a fresh JS buffer, matching the wire API.
 * Feature constants remove messages for verification absent from the build.
 */
const littleEndian = /* @__PURE__ */ (() =>
  new Uint8Array(new Uint16Array([1]).buffer)[0] === 1)();
// Keep one copy of each message across warm-up, preflight and decoding. Build
// constants erase verification messages for policies absent from the module.
export function failure(status) {
  if (status === 8) return RangeError("Wasm decoder memory allocation failed");
  return Error(
    status === 2
      ? "Invalid payload length"
      : status === 9
        ? "Unsupported payload codec"
        : status === 10
          ? "Unsupported memory optimization option"
          : PAYLOAD_INCLUDE_FORMAT && status === 1
            ? "Invalid payload character"
            : PAYLOAD_INCLUDE_FORMAT && status === 3
              ? "Invalid payload header"
              : PAYLOAD_INCLUDE_FORMAT && status === 4
                ? "Invalid payload padding"
                : PAYLOAD_CHECK_DATA && status === 5
                  ? "Required payload integrity mode missing"
                  : PAYLOAD_ALLOW_FAST && status === 6
                    ? "Payload checksum mismatch"
                    : PAYLOAD_ALLOW_SECURE && status === 7
                      ? "Payload digest mismatch"
                      : "Wasm decoder failure",
  );
}
// Imports have already instantiated Wasm. Explicit warm-up only prepares its
// selected reusable lookup caches; decoding also initializes them as needed.
export function warmWasm(api, codecs, heavy) {
  const status = api.warmup(codecs, heavy);
  if (status) throw failure(status);
}
export function runWasm(api, text, verifyFormat, dataKind, memoryHeavy) {
  // Dispatch before reserving/copying a large input. The kernel independently
  // repeats this guard for direct ABI callers, even in unchecked builds.
  const length = text.length;
  if (length < 2) throw failure(2);
  const first = text.charCodeAt(0);
  if(!((PAYLOAD_ALLOW_PAIR&&first===9)||(PAYLOAD_ALLOW_ANS&&first===10)||(PAYLOAD_ALLOW_WINDOWS&&first===12)))throw failure(9);
  const pointer = api.input_ptr(length);
  if (pointer === 0 && length) throw failure(8);
  // memory growth invalidates old views, so obtain the input view AFTER reserve
  // and obtain the output view AFTER decoding. Never retain either arena view.
  if (littleEndian) {
    const input = new Uint16Array(api.memory.buffer, pointer, length);
    for (let i = 0; i < length; i++) input[i] = text.charCodeAt(i);
  } else {
    const input = new DataView(api.memory.buffer, pointer, length * 2);
    for (let i = 0; i < length; i++)
      input.setUint16(i * 2, text.charCodeAt(i), true);
  }
  const status = api.decode(+verifyFormat, dataKind, +memoryHeavy);
  if (status) throw failure(status);
  const stored = api.stored_len(),
    end = api.payload_len(),
    bytes = new Uint8Array(stored);
  bytes.set(new Uint8Array(api.memory.buffer, api.output_ptr(), stored));
  return end === stored ? bytes : bytes.subarray(0, end);
}
