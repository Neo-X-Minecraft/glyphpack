/* 0BSD, NeoX. Raw UTF-8 API: always strict, without an integrity trailer. */
import { prepare, warmup } from "./model.mjs";
import { unpack } from "./unpack.mjs";
export { warmup };
export function decode(text) {
  return unpack(text, prepare(text), true);
}
