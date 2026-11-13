/* 0BSD, NeoX. SO + integrity digit + ~c1; shared existing hash policy. */
import {
  prepareCompact,
  unpackCompact,
  warmCompact as warmEnumerator,
  protect,
} from "./compact-core.mjs";
import { prepare, warmup as warmFast } from "./utf8-model.mjs";
import { unpack } from "./utf8-unpack.mjs";
import { trailerLength, verifyStored } from "./stored.js";
import { failure } from "./wasm-runtime.js";
export function warmCompact() {
  warmEnumerator();
  warmFast();
}
export function runCompact(api, text, verifyFormat, dataKind) {
  if (text.length < 8) throw failure(2);
  const kind = text.charCodeAt(1) - 48,
    payload = text.slice(2),
    fast = payload.startsWith("~u2"),
    raw = fast ? payload.replace(/<\x01\x01\x01/g, "<") : payload,
    check =
      typeof UTF8_FORMAT_RUNTIME === "undefined"
        ? true
        : UTF8_FORMAT_RUNTIME
          ? verifyFormat
          : UTF8_VERIFY_FORMAT;
  if (fast && check && protect(raw) !== payload)
    throw Error("Invalid payload padding");
  const header = fast ? prepare(raw) : prepareCompact(raw),
    trailer = trailerLength(kind, header.length, dataKind);
  return verifyStored(
    api,
    fast
      ? unpack(raw, header, verifyFormat)
      : unpackCompact(raw, header, verifyFormat),
    trailer,
    dataKind,
  );
}
