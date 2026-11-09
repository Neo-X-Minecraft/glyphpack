/* Optional text-structure checks. Mandatory allocation guards live separately
 * in allocation.js. The post-decode coverage check here is retained for either
 * format or data verification; only it establishes actual supplied-byte coverage.
 */
import {invalidLength} from './allocation.js';
// Preserve these internal helper exports for existing custom build entries.
export {invalidLength,checkCapacity} from './allocation.js';
export function invalidCharacter(){throw Error('Invalid payload character');}

// Validate before reading a two-symbol header. Alphabet indices are stored +1.
export function checkStart(text){if(text.length<2)invalidLength();}
export function checkHeaderSymbols(a,b){if(!a||!b)invalidCharacter();}

// Long headers occupy indices 32768..33791 and require a third symbol.
export function checkLongPrefix(first,textLength){
  if(first>=33792)throw Error('Invalid payload header');
  if(textLength<3)invalidLength();
}
export function checkLongLength(length,radix){
  if(length<32*radix)throw Error('Invalid payload header');
}

// Reject reserved kinds, half-pairs and digest trailers longer than their packet.
export function checkShape(bodyLength,kind,length,digestLength){
  if(kind===3||bodyLength%2||length<digestLength)invalidLength();
}

// Post-decode coverage is distinct from pre-allocation maximum capacity. A pair
// may yield 31 rather than 32 bits; verified decoding must not accept zero fill.
export function checkDecodedLength(at,length){if(at<length)invalidLength();}

// word/carry still contain transport bits before XOR restoration. Unused bits
// were padded with zero by the encoder, even when the restored mask is nonzero.
export function checkTail(carry,word,last,length,at,hasBody){
  const used=length-at+last;
  if(hasBody&&used<=0)invalidLength();
  if(carry||(used<4&&(word>>>(8*used))))throw Error('Invalid payload padding');
}
