/* 0BSD, NeoX. Shared integrity policy for JS-decoded UTF-8 transports. */
import { failure } from "./wasm-runtime.js";
export function trailerLength(kind, length, dataKind) {
  if (kind < 0 || kind > 2) throw Error("Invalid payload header");
  const trailer = kind === 1 ? 4 : kind === 2 ? 32 : 0;
  if (length < trailer) throw failure(2);
  if (PAYLOAD_CHECK_DATA && dataKind !== 0 && kind !== dataKind)
    throw failure(5);
  return trailer;
}
export function verifyStored(api, bytes, trailer, dataKind) {
  if (PAYLOAD_CHECK_DATA && dataKind !== 0) {
    const pointer = api.input_ptr(Math.ceil(bytes.length / 2));
    if (!pointer && bytes.length) throw failure(8);
    new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
    const status = api.verify_bytes(bytes.length, dataKind);
    if (status) throw failure(status);
  }
  return trailer ? bytes.subarray(0, bytes.length - trailer) : bytes;
}
