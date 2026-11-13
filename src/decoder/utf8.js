/* 0BSD, NeoX. Format-4 UTF-8: VT, integrity digit, unchanged raw ~u2 packet.
 * JS unpacks; selected Rust/Wasm hashes verify decoded stored bytes. Raw-only
 * builds erase this verifier and need neither Wasm nor a decompression loader. */
import { prepare, warmup } from "./utf8-model.mjs";
import { unpack } from "./utf8-unpack.mjs";
import { failure } from "./wasm-runtime.js";
import { trailerLength, verifyStored } from "./stored.js";
export { warmup as warmUtf8 };
export function runUtf8(api, text, verifyFormat, dataKind) {
  if (text.length < 8) throw failure(2);
  const kind = text.charCodeAt(1) - 48;
  const header = prepare(text, 2),
    trailer = trailerLength(kind, header.length, dataKind);
  const bytes = unpack(text, header, verifyFormat);
  return verifyStored(api, bytes, trailer, dataKind);
}
