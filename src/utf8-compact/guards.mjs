/* 0BSD, NeoX. Reversible guards for inert HTML script data. */
export function protect(text) {
  return text.replace(/<(?=\/?script|!--|\x01\x01\x01)/gi, "<\x01\x01\x01");
}
