/* Mandatory allocation safety, independent of optional verification.
 * Every profile keeps these O(1) predicates before allocating output; core.js
 * inlines them to minimize calls and generated size. Skipping
 * symbol/padding checks or hashing does not authorize arbitrary allocation sizes.
 */
export function invalidLength(){throw Error('Invalid payload length');}

// Header lookups can become NaN when text is incomplete and format checks are
// off. Require an actual nonnegative integer and reserve the declared digest
// size even when verification is off. This also prevents negative subarray ends
// while stripping trailers; it is independent of format/canonicality checking.
export function checkAllocationLength(length,minimum){
  if(!Number.isSafeInteger(length)||length<minimum)invalidLength();
}

// Each two-character pair supplies at most four bytes. Bounding output by the
// available body prevents tiny inputs from declaring disproportionately large
// buffers. Real decoded-byte coverage is checked separately after unpacking when
// either format or data verification is enabled.
export function checkCapacity(length,bodyLength){
  if(length>bodyLength*2)invalidLength();
}
