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
import {checkAllocationLength,checkCapacity} from './allocation.js';
import {invalidCharacter,checkStart,checkHeaderSymbols,checkLongPrefix,checkLongLength,checkShape,checkDecodedLength,checkTail} from './format.js';
import {checkIntegrityMode,verifyData} from './integrity.js';
/* @OPTIONS_IMPORTS */

// carry/bits hold read-but-not-emitted bits. Byte draining leaves bits in 0..7;
// adding a 31/32-bit pair conceptually needs at most 39 bits. word keeps the low
// 32, and the carry is recovered from the original value before it is truncated.
function unpack(text,start,length,maskByte/* @UNPACK_PARAMS */){
  const mask=(maskByte*0x01010101)|0;
  const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);
  let carry=0,bits=0,at=0,word=0,last=0;
  for(let i=start;i<text.length;i+=2){
    const x=table[text.charCodeAt(i)],y=table[text.charCodeAt(i+1)];
    // Compile-time false removes the entire test and its error function.
    if(PAYLOAD_VERIFY_FORMAT&&(!x||!y))invalidCharacter();
    const value=x-1+radix*(y-1);
    word=carry|(value<<bits);
    // Restore the byte mask once per four-byte write, with no second pass.
    const output=word^mask;
    // The next write overwrites a speculative fourth byte when only three
    // bytes are committed below. Indexed tail stores ignore out-of-range bytes;
    // DataView writes require the explicit bounds check to avoid throwing.
    if(at+4<=length)view.setUint32(at,output,true);
    else{bytes[at]=output;bytes[at+1]=output>>>8;bytes[at+2]=output>>>16;bytes[at+3]=output>>>24;}
    const narrow=(value&0x7fffffff)>threshold;
    if(bits===0&&narrow){
      carry=word>>>24;bits=7;last=3;
    }else{
      // Guard bits=0 because a JS shift by 32 actually shifts by zero.
      carry=bits?value>>>(32-bits):0;bits-=narrow;last=4;
    }
    at+=last;
  }
  // Integrity-only builds still reject missing bytes rather than hashing the
  // allocation's implicit zero fill. This establishes decoded-byte coverage;
  // digest-buffer bounds alone cannot prove that the input supplied those bytes.
  if(PAYLOAD_VERIFY_FORMAT||PAYLOAD_CHECK_DATA)checkDecodedLength(at,length);
  if(PAYLOAD_VERIFY_FORMAT)checkTail(carry,word,last,length,at,text.length>start);
  return bytes;
}

// Build markers add parameters/selectors only when an axis has multiple choices.
// Fixed builds retain this exact fast path with no options parser or dispatcher.
export function binary(text/* @BINARY_PARAMS */){
  /* @OPTIONS_INIT */
  if(PAYLOAD_VERIFY_FORMAT)checkStart(text);
  const a=table[text.charCodeAt(0)],b=table[text.charCodeAt(1)];
  if(PAYLOAD_VERIFY_FORMAT)checkHeaderSymbols(a,b);
  const first=a-1;let length,start=2,mode=0;
  // Explicit legacy builds contain only the old header reader; modern builds
  // contain only the format-3 reader. Neither carries a runtime legacy branch.
  if(PAYLOAD_LEGACY)length=first+radix*(b-1);
  else{
    mode=first&1023;
    if(first<32768)length=(first>>>10)*radix+b-1;
    else{
      if(PAYLOAD_VERIFY_FORMAT)checkLongPrefix(first,text.length);
      const c=table[text.charCodeAt(2)];
      if(PAYLOAD_VERIFY_FORMAT&&!c)invalidCharacter();
      start=3;length=b-1+radix*(c-1);
      if(PAYLOAD_VERIFY_FORMAT)checkLongLength(length,radix);
    }
  }
  // Length includes any trailer. Metadata parsing/stripping is necessary to
  // read protected packets even when a caller explicitly builds without checks.
  const kind=mode>>>8,mask=mode&255,digestLength=kind===1?4:kind===2?32:0;
  if(PAYLOAD_VERIFY_FORMAT)checkShape(text.length-start,kind,length,digestLength);
  // Mandatory even with BOTH optional checks off: reject NaN/negative/fractional
  // lengths and declarations exceeding the maximum bytes available in the body.
  // Only verified modes require room for a declared digest at this stage.
  checkAllocationLength(length,PAYLOAD_CHECK_DATA?digestLength:0);
  checkCapacity(length,text.length-start);
  if(PAYLOAD_CHECK_DATA)checkIntegrityMode(kind,length/* @MODE_ARGS */);
  const bytes=unpack(text,start,length,mask/* @UNPACK_ARGS */),end=length-digestLength;
  if(PAYLOAD_CHECK_DATA)verifyData(bytes,end/* @HASH_ARGS */);
  // Return a view of the original bytes without a second payload-sized copy.
  return digestLength?bytes.subarray(0,end):bytes;
}
