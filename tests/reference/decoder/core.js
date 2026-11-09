/* Optimized dense BMP transport decoder. Only decoding belongs here.
 * Build-time feature gates are replaced with constants by builder.rs.
 * Unused imports, checks and hash implementations are then eliminated entirely.
 *
 * binary(text) accepts an already decoded JS string and returns original bytes.
 * Payloads remain format 3: header -> body pairs, bytewise XOR, optional trailer.
 * All profiles enforce integer lengths and available-input allocation bounds.
 * The core always restores XOR and strips a declared trailer, even in unchecked
 * builds; those are decoding operations, independent of optional verification.
 * A single selected policy stays fixed. Multiple selected policies add runtime
 * options only for their varying axes; the legacy reader remains build-time only.
 * Integrity covers decoded bytes, not text spelling. With format checks off,
 * invalid/noncanonical text can decode to the same bytes. Format checks enforce
 * the alphabet/header/padding rules, not a unique XOR mask or a text signature.
 */
import {table,radix,threshold} from './alphabet.js';
import {invalidLength} from './allocation.js';
import {invalidCharacter} from './format.js';
import {checkIntegrityMode,verifyData} from './integrity.js';
/* @OPTIONS_IMPORTS */

// Pair digits are one-based lookup entries. This bias allows one subtraction
// instead of subtracting one from both digits in every pair. All intermediate
// integers fit exactly in a JS Number; invalid/missing digits retain NaN/coercion
// behavior when callers deliberately disable format checking.
const radixBias=radix+1;

// carry/bits hold read-but-not-emitted bits. Byte draining leaves bits in 0..7;
// adding a 31/32-bit pair conceptually needs at most 39 bits. word keeps the low
// 32, and the carry is recovered from the original value before it is truncated.
function unpack(text,start,length,maskByte/* @UNPACK_PARAMS */){
  const fullEnd=length-4;
  const mask=(maskByte*0x01010101)|0;
  const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);
  // Only builds including format checks need final-width bookkeeping. The
  // INCLUDE flag is static even in a runtime-selectable build: it adds no
  // per-pair options branch and removes dead writes from no-format profiles.
  // The builder also omits last's declaration entirely in those profiles.
  let carry=0,bits=0,at=0,word=0,last=0;
  // Strings are immutable; cache the loop bound and reuse it in tail validation.
  const textEnd=text.length;
  let i=start;
  // The builder expands the single pair implementation below into a four-pair
  // bulk loop here. Its front bounds guarantee four complete DataView stores,
  // even when a narrow pair advances only three bytes. No alignment assumption
  // or extra output allocation is needed. The original loop handles the tail.
  /* @BULK_LOOP */
  for(;i<textEnd;i+=2){
    /* @PAIR_BEGIN */
    const x=table[text.charCodeAt(i)],y=table[text.charCodeAt(i+1)];
    // Compile-time false removes the entire test and its error function.
    if(PAYLOAD_VERIFY_FORMAT&&(!x||!y))invalidCharacter();
    const value=x+radix*y-radixBias;
    word=carry|(value<<bits);
    // Restore the byte mask once per four-byte write, with no second pass.
    const output=word^mask;
    // The next write overwrites a speculative fourth byte when only three
    // bytes are committed below. Indexed tail stores ignore out-of-range bytes;
    // DataView writes require the explicit bounds check to avoid throwing.
    /* @STORE_BEGIN */
    if(at<=fullEnd)view.setUint32(at,output,true);
    else{bytes[at]=output;bytes[at+1]=output>>>8;bytes[at+2]=output>>>16;bytes[at+3]=output>>>24;}
    /* @STORE_END */
    const narrow=(value&0x7fffffff)>threshold;
    // Separate zero shift: JS shifts by 32 behave like shifts by zero. The
    // nonzero path can therefore use one direct carry extraction with no ternary.
    if(bits===0){
      if(narrow){carry=word>>>24;bits=7;at+=3;if(PAYLOAD_INCLUDE_FORMAT)last=3;}
      else{carry=0;at+=4;if(PAYLOAD_INCLUDE_FORMAT)last=4;}
    }else{
      carry=value>>>(32-bits);bits-=narrow;at+=4;if(PAYLOAD_INCLUDE_FORMAT)last=4;
    }
    /* @PAIR_END */
  }
  // Integrity-only builds still reject missing bytes rather than hashing the
  // allocation's implicit zero fill. This establishes decoded-byte coverage;
  // digest-buffer bounds alone cannot prove that the input supplied those bytes.
  if((PAYLOAD_VERIFY_FORMAT||PAYLOAD_CHECK_DATA)&&at<length)invalidLength();
  // Preserve the original error priority: missing bytes, excess pairs, padding.
  // These checks remain optional; the pre-allocation bounds below never are.
  if(PAYLOAD_VERIFY_FORMAT){
    const remaining=length-at+last;
    if(textEnd>start&&remaining<=0)invalidLength();
    if(carry||(remaining<4&&(word>>>(8*remaining))))throw Error('Invalid payload padding');
  }
  return bytes;
}
/* @UNPACK_END */

// Build markers add parameters/selectors only when an axis has multiple choices.
// Fixed builds retain this exact fast path with no options parser or dispatcher.
export function binary(text/* @BINARY_PARAMS */){
  /* @OPTIONS_INIT */
  if(PAYLOAD_VERIFY_FORMAT&&text.length<2)invalidLength();
  const a=table[text.charCodeAt(0)],b=table[text.charCodeAt(1)];
  if(PAYLOAD_VERIFY_FORMAT&&(!a||!b))invalidCharacter();
  const first=a-1;let length,start=2,mode=0;
  // Explicit legacy builds contain only the old header reader; modern builds
  // contain only the format-3 reader. Neither carries a runtime legacy branch.
  if(PAYLOAD_LEGACY)length=first+radix*(b-1);
  else{
    mode=first&1023;
    if(first<32768)length=(first>>>10)*radix+b-1;
    else{
      if(PAYLOAD_VERIFY_FORMAT){
        if(first>=33792)throw Error('Invalid payload header');
        if(text.length<3)invalidLength();
      }
      const c=table[text.charCodeAt(2)];
      if(PAYLOAD_VERIFY_FORMAT&&!c)invalidCharacter();
      start=3;length=b-1+radix*(c-1);
      if(PAYLOAD_VERIFY_FORMAT&&length<32*radix)throw Error('Invalid payload header');
    }
  }
  // Length includes any trailer. Metadata parsing/stripping is necessary to
  // read protected packets even when a caller explicitly builds without checks.
  const kind=mode>>>8,mask=mode&255,digestLength=kind===1?4:kind===2?32:0;
  if(PAYLOAD_VERIFY_FORMAT&&(kind===3||(text.length-start)%2))invalidLength();
  // Mandatory even with BOTH optional checks off: reject NaN/negative/fractional
  // lengths and declarations exceeding the maximum bytes available in the body.
  // A declared trailer must fit even when hashing is disabled; otherwise a
  // negative subarray end would silently expose the wrong payload prefix.
  // Inline the two O(1) allocation predicates together. Do not gate this guard
  // on either optional verification setting, including in the minimal build.
  if(!Number.isSafeInteger(length)||length<digestLength||length>(text.length-start)*2)invalidLength();
  if(PAYLOAD_CHECK_DATA)checkIntegrityMode(kind,length/* @MODE_ARGS */);
  const bytes=unpack(text,start,length,mask/* @UNPACK_ARGS */),end=length-digestLength;
  if(PAYLOAD_CHECK_DATA)verifyData(bytes,end/* @HASH_ARGS */);
  // Return a view of the original bytes without a second payload-sized copy.
  return digestLength?bytes.subarray(0,end):bytes;
}
