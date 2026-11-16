/* 0BSD, NeoX. Current compact ANS or adaptive fast representation only. */
import { runAns } from "./compact-ans.mjs";
import { unprotect } from "./compact-guards.mjs";
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
    payload = text.slice(2);
  if (!payload.startsWith("~u2")) throw Error("Unsupported payload format");
  const raw = unprotect(payload, verifyFormat);
  const header = prepare(raw),
    trailer = trailerLength(kind, header.length, dataKind);
  return verifyStored(
    api,
    unpack(raw, header, verifyFormat),
    trailer,
    dataKind,
  );
}
