/* 0BSD, NeoX. Benchmark-only: native UTF-8 conversion, input/output copies and
 * validation are all inside decode(). Import/instantiation is measured separately
 * from warm decoding. This loader is excluded from delivered portable builds. */
import { prepare, warmup } from "../prefix.mjs";
const raw = Uint8Array.from(atob(UTF8_KERNEL_BASE64), (c) => c.charCodeAt(0));
const api = (await WebAssembly.instantiate(raw)).instance.exports;
const encoder = new TextEncoder();
const errors = {
  1: "Invalid payload character",
  2: "Invalid payload length",
  3: "Invalid UTF-8 header",
  4: "Invalid payload padding",
  9: "Unsupported UTF-8 profile",
};
export { warmup };
export function decode(text) {
  prepare(text);
  const pointer = api.reserve(text.length);
  if (!pointer) throw Error("Invalid payload length");
  const target = new Uint8Array(
    api.memory.buffer,
    pointer,
    api.input_capacity(),
  );
  const { read, written } = encoder.encodeInto(text, target);
  if (read !== text.length) throw Error("Invalid payload character");
  const status = api.decode(written);
  if (status) throw Error(errors[status]);
  return new Uint8Array(
    api.memory.buffer,
    api.output_ptr(),
    api.output_len(),
  ).slice();
}
