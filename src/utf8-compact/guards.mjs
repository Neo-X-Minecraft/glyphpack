/* 0BSD, NeoX. Most packets need no script-data escaping. Return their original
 * string after one native scan, without replacement strings or callbacks. */
const special = /<(?:\/?script|!--|\x01\x01\x01)/i;
export function unprotect(text, verifyFormat) {
  const check =
    typeof UTF8_FORMAT_RUNTIME === "undefined"
      ? verifyFormat
      : UTF8_FORMAT_RUNTIME
        ? verifyFormat
        : UTF8_VERIFY_FORMAT;
  if (check) {
    if (!special.test(text)) return text;
    // After '<', a triple guard is required exactly before a script transition
    // or a natural triple guard. The negative lookahead excludes those valid
    // spellings; the final alternatives catch missing and unnecessary guards.
    // Fixed-length alternatives keep this scan linear even for guard-heavy data.
    if (
      /<(?!(?:\x01\x01\x01)(?:\/?script|!--|\x01\x01\x01))(?:\x01\x01\x01|\/?script|!--)/i.test(text)
    )
      throw Error("Invalid payload padding");
  }
  // Fixed unchecked builds retain only this replacement. No validator or
  // optional error message remains in their bundled code.
  return text.replace(/<\x01\x01\x01/g, "<");
}
