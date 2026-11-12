/* 0BSD, NeoX. Differential checks for the independent browser candidate.
 * Use benchmarks/utf8-proposal.cjs for actual browser/file navigation checks. */
import assert from "node:assert/strict";
import {
  arithmeticEncode,
  arithmeticDecode,
  decodeArithmetic,
  distribution,
} from "./reference/arithmetic.mjs";
import { modelFor, protect } from "./reference/codec.mjs";
import { decodeDenseBrowser } from "./dense-browser.mjs";
let seed = 815,
  cases = 0;
function check(data) {
  const encoded = arithmeticEncode(data);
  for (const text of [encoded, encoded.replaceAll("\0", "\ufffd")]) {
    assert.deepEqual(decodeDenseBrowser(text, data.length), data);
    cases++;
  }
  return encoded;
}
for (let n = 0; n < 256; n++)
  for (let pattern = 0; pattern < 4; pattern++) {
    check(
      Uint8Array.from({ length: n }, (_, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return pattern === 0
          ? seed >>> 24
          : pattern === 1
            ? 0
            : pattern === 2
              ? 255
              : i & 255;
      }),
    );
  }
for (let byte = 0; byte < 256; byte++) check(Uint8Array.of(byte));
for (const n of [1024, 4095, 4096, 4097, 65536, 1048576]) {
  check(
    Uint8Array.from({ length: n }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    }),
  );
}
// Generate valid binary inputs whose encoded text deliberately starts with an
// HTML hazard or a natural guard. This test-only fork stops at the requested
// output length, allowing a generously padded symbol stream to supply a prefix.
// Re-encoding the recovered bytes must retain the targeted leading symbols.
const source = arithmeticDecode.toString(),
  needle = "if (bits >= n * 8) throw Error('Trailing');";
assert(source.includes(needle));
const prefixDecode = Function(
  "return (" + source.replace(needle, "if (bits >= n * 8) break;") + ")",
)();
const model = modelFor("utf8-data", 1),
  cdf = distribution();
let guarded = 0;
for (const prefix of [
  "</script>",
  "</ScRiPt >",
  "<!--",
  "<\x01\x01\x01",
  "<\x01\x01\x01\x01\x01\x01",
  "${globalThis.injected=1}",
  "\0",
  "😀",
]) {
  const data = prefixDecode(
    protect(prefix + "A".repeat(256)),
    128,
    model.alphabet,
    true,
    cdf,
  );
  const encoded = check(data);
  assert(encoded.startsWith(protect(prefix)), "Missed targeted prefix");
  assert.deepEqual(decodeArithmetic(encoded, data.length), data);
  guarded++;
}
for (const [text, length] of [
  ["", 1],
  ["A", 1048576],
  ["\r", 1],
  ["\ud800", 1],
  ["\udc00", 1],
  ["", NaN],
  ["", -1],
]) {
  assert.throws(() => decodeDenseBrowser(text, length));
}
const text = check(Uint8Array.from({ length: 128 }, (_, i) => i));
assert.throws(() => decodeDenseBrowser(text.slice(0, -20), 128));
assert.throws(() => decodeDenseBrowser(text + "A", 128));
console.log(
  JSON.stringify({
    passed: true,
    cases,
    targetedPrefixes: guarded,
    malformed: 9,
  }),
);
