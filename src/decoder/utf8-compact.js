/* 0BSD, NeoX. Current compact ANS or adaptive fast representation only. */
import { runAns } from "./compact-ans.mjs";
import { protect } from "./compact-guards.mjs";
import { prepare, warmup as warmFast } from "./utf8-model.mjs";
import { unpack } from "./utf8-unpack.mjs";
import { trailerLength, verifyStored } from "./stored.js";
import { failure } from "./wasm-runtime.js";
export function warmCompact() {
  warmFast();
}
export function runCompact(api, text, verifyFormat, dataKind) {
  if (text.length < 8) throw failure(2);
  if (text.slice(2, 5) === "~c2")
    return runAns(api, text, verifyFormat, dataKind);
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
  if (!fast) throw Error("Unsupported payload format");
  const header = prepare(raw),
    trailer = trailerLength(kind, header.length, dataKind);
  return verifyStored(
    api,
    unpack(raw, header, verifyFormat),
    trailer,
    dataKind,
  );
}
