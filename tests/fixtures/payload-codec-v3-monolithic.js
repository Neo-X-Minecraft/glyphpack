/* Dense BMP format-3 decoder. Public API:
 *   binary(text, {verifyFormat=true, verifyData='none', legacy=false})
 *     -> Uint8Array containing the original bytes, excluding any digest trailer.
 *
 * text is an already decoded JavaScript string, e.g. a data element's
 * textContent or the result of TextDecoder('utf-16le'). This file does not parse
 * HTML or decompress bytes. Each allowed BMP symbol occupies one JS code unit;
 * two symbols encode one 31- or 32-bit group.
 *
 * The encoder writes: original bytes -> optional digest -> bytewise XOR -> text.
 * We reverse that order, then optionally hash the recovered original bytes.
 * verifyFormat checks symbols, header shape, length and zero padding.
 * verifyData is 'none' (default), 'fast' (XXH32), or 'secure' (BLAKE3-256).
 * false/true are aliases for none/fast. The requested tier must match the packet.
 * XOR restoration always runs, regardless of verification settings.
 *
 * With both checks off, malformed text is outside the API's trusted-input
 * contract: it may produce garbage or zero-filled bytes instead of an error.
 * Data verification alone still enforces enough decoded bytes and the expected
 * integrity kind, preventing silent zero filling or an integrity downgrade.
 *
 * Format version is agreed by encoder and decoder, not auto-detected. legacy
 * explicitly selects format 1's unmasked/unprotected two-digit length header.
 * The private lookup is initialized once here and reused by subsequent calls.
 */
const binary=(()=>{
  // This ordered alphabet must exactly match payload_encoder.py. Exclude '<'
  // for HTML raw-text embedding, controls, surrogates, noncharacters, BOM, and
  // JS line/paragraph separators. Every remaining symbol is one UTF-16 unit.
  const table=new Uint16Array(65536);let radix=0;
  for(let c=32;c<65534;c++){
    if(c===60||(c>=127&&c<=159)||(c>=55296&&c<=57343)||(c>=64976&&c<=65007)||c===65279||c===8232||c===8233)continue;
    table[c]=++radix;
  }
  // Zero marks an invalid symbol; indices are stored plus one so alphabet
  // index zero remains distinguishable from the typed array's default zero.
  // R^2 symbol pairs cover all 31-bit values and some 32-bit values. Values
  // whose low 31 bits exceed this boundary consume 31 bits, otherwise 32.
  const threshold=radix*radix-2147483649;
  // No BLAKE3 arrays or hashing work until the first secure verification.
  let secureHash;

  // XXH32, seed zero, over data[0..end). No table is needed. This fast 32-bit
  // check detects accidental changes; it does not provide collision resistance.
  function xxhash32(data,end=data.length){
    // Explicit little-endian reads support any host order and byte alignment.
    const v=new DataView(data.buffer,data.byteOffset,end);let i=0,h;
    if(end>=16){
      // Four parallel lanes consume 16-byte stripes; initial values are the
      // standard seed-zero XXH32 constants. imul gives the low 32 product bits.
      let a=0x24234428,b=0x85ebca77|0,c=0,d=-0x9e3779b1|0;
      for(;i+16<=end;i+=16){
        a=(a+Math.imul(v.getUint32(i,true),0x85ebca77))|0;a=Math.imul((a<<13)|(a>>>19),0x9e3779b1);
        b=(b+Math.imul(v.getUint32(i+4,true),0x85ebca77))|0;b=Math.imul((b<<13)|(b>>>19),0x9e3779b1);
        c=(c+Math.imul(v.getUint32(i+8,true),0x85ebca77))|0;c=Math.imul((c<<13)|(c>>>19),0x9e3779b1);
        d=(d+Math.imul(v.getUint32(i+12,true),0x85ebca77))|0;d=Math.imul((d<<13)|(d>>>19),0x9e3779b1);
      }
      // Fold lanes together, then handle the shorter word/byte tail below.
      h=((a<<1)|(a>>>31))+((b<<7)|(b>>>25))+((c<<12)|(c>>>20))+((d<<18)|(d>>>14));
    }else h=0x165667b1;
    h=(h+end)|0;
    for(;i+4<=end;i+=4){h=(h+Math.imul(v.getUint32(i,true),0xc2b2ae3d))|0;h=Math.imul((h<<17)|(h>>>15),0x27d4eb2f);}
    for(;i<end;i++){h=(h+Math.imul(data[i],0x165667b1))|0;h=Math.imul((h<<11)|(h>>>21),0x9e3779b1);}
    // Avalanche and normalize to an unsigned JS number for trailer comparison.
    h^=h>>>15;h=Math.imul(h,0x85ebca77);h^=h>>>13;h=Math.imul(h,0xc2b2ae3d);h^=h>>>16;return h>>>0;
  }

  // Unkeyed, one-shot BLAKE3-256 only. Private synchronous scratch is reused.
  // This is cryptographic hashing, not keyed authentication; replacing both
  // the original bytes and their digest is outside an unkeyed hash's guarantee.
  // CHUNK_START=1, CHUNK_END=2, PARENT=4, ROOT=8.
  function createBlake3(){
    // Compress one block into cv in place. Only output words 0..7 are needed
    // for chaining values and the fixed 32-byte root digest; no XOF/key/KDF API.
    function compress(cv,m,offset,lo,hi,length,flags){
      // State 0..7 is the input CV, 8..11 the first four IV words. The counter,
      // block length and flags directly occupy 12..15 (no XOR with IV there).
      // Signed locals and |0 additions retain the required modulo-2^32 bits.
      let s0=cv[0]|0,s1=cv[1]|0,s2=cv[2]|0,s3=cv[3]|0,s4=cv[4]|0,s5=cv[5]|0,s6=cv[6]|0,s7=cv[7]|0,
        s8=0x6a09e667,s9=0xbb67ae85|0,s10=0x3c6ef372,s11=0xa54ff53a|0,
        s12=lo|0,s13=hi|0,s14=length,s15=flags;
      // Load once into scalar locals: the hot round never allocates arrays or
      // calls an indexed G helper. m/offset may reference input or scratch.
      let m0=m[offset+0]|0,m1=m[offset+1]|0,m2=m[offset+2]|0,m3=m[offset+3]|0,m4=m[offset+4]|0,m5=m[offset+5]|0,m6=m[offset+6]|0,m7=m[offset+7]|0,m8=m[offset+8]|0,m9=m[offset+9]|0,m10=m[offset+10]|0,m11=m[offset+11]|0,m12=m[offset+12]|0,m13=m[offset+13]|0,m14=m[offset+14]|0,m15=m[offset+15]|0;
      for(let round=0;round<7;round++){
        // Four column G mixes. Each four-line group adds two message words
        // and uses XOR/right rotations of 16, 12, 8 and 7 bits, in that order.
        s0=(s0+s4+m0)|0;s12^=s0;s12=(s12>>>16)|(s12<<16);
        s8=(s8+s12)|0;s4^=s8;s4=(s4>>>12)|(s4<<20);
        s0=(s0+s4+m1)|0;s12^=s0;s12=(s12>>>8)|(s12<<24);
        s8=(s8+s12)|0;s4^=s8;s4=(s4>>>7)|(s4<<25);
        s1=(s1+s5+m2)|0;s13^=s1;s13=(s13>>>16)|(s13<<16);
        s9=(s9+s13)|0;s5^=s9;s5=(s5>>>12)|(s5<<20);
        s1=(s1+s5+m3)|0;s13^=s1;s13=(s13>>>8)|(s13<<24);
        s9=(s9+s13)|0;s5^=s9;s5=(s5>>>7)|(s5<<25);
        s2=(s2+s6+m4)|0;s14^=s2;s14=(s14>>>16)|(s14<<16);
        s10=(s10+s14)|0;s6^=s10;s6=(s6>>>12)|(s6<<20);
        s2=(s2+s6+m5)|0;s14^=s2;s14=(s14>>>8)|(s14<<24);
        s10=(s10+s14)|0;s6^=s10;s6=(s6>>>7)|(s6<<25);
        s3=(s3+s7+m6)|0;s15^=s3;s15=(s15>>>16)|(s15<<16);
        s11=(s11+s15)|0;s7^=s11;s7=(s7>>>12)|(s7<<20);
        s3=(s3+s7+m7)|0;s15^=s3;s15=(s15>>>8)|(s15<<24);
        s11=(s11+s15)|0;s7^=s11;s7=(s7>>>7)|(s7<<25);
        // Four diagonal G mixes complete the round.
        s0=(s0+s5+m8)|0;s15^=s0;s15=(s15>>>16)|(s15<<16);
        s10=(s10+s15)|0;s5^=s10;s5=(s5>>>12)|(s5<<20);
        s0=(s0+s5+m9)|0;s15^=s0;s15=(s15>>>8)|(s15<<24);
        s10=(s10+s15)|0;s5^=s10;s5=(s5>>>7)|(s5<<25);
        s1=(s1+s6+m10)|0;s12^=s1;s12=(s12>>>16)|(s12<<16);
        s11=(s11+s12)|0;s6^=s11;s6=(s6>>>12)|(s6<<20);
        s1=(s1+s6+m11)|0;s12^=s1;s12=(s12>>>8)|(s12<<24);
        s11=(s11+s12)|0;s6^=s11;s6=(s6>>>7)|(s6<<25);
        s2=(s2+s7+m12)|0;s13^=s2;s13=(s13>>>16)|(s13<<16);
        s8=(s8+s13)|0;s7^=s8;s7=(s7>>>12)|(s7<<20);
        s2=(s2+s7+m13)|0;s13^=s2;s13=(s13>>>8)|(s13<<24);
        s8=(s8+s13)|0;s7^=s8;s7=(s7>>>7)|(s7<<25);
        s3=(s3+s4+m14)|0;s14^=s3;s14=(s14>>>16)|(s14<<16);
        s9=(s9+s14)|0;s4^=s9;s4=(s4>>>12)|(s4<<20);
        s3=(s3+s4+m15)|0;s14^=s3;s14=(s14>>>8)|(s14<<24);
        s9=(s9+s14)|0;s4^=s9;s4=(s4>>>7)|(s4<<25);
        // Intentionally shuffle after all seven rounds, including the unused last one.
        // This fixed-count loop beat an early exit in 150/150 paired Chromium 156
        // ARM64 trials. Exact compiler cause is unconfirmed; benchmark before changing.
        // Results: ../reports/blake3-permutation-recheck.json
        // next[i]=old[[2,6,3,10,7,0,4,13,1,11,12,5,9,14,15,8][i]].
        // Two eight-element cycles implement it with one temporary.
        let t=m0;m0=m2;m2=m3;m3=m10;m10=m12;m12=m9;m9=m11;m11=m5;m5=t;
        t=m1;m1=m6;m6=m4;m4=m7;m7=m13;m13=m14;m14=m15;m15=m8;m8=t;
      }
      // ROOT must already have been set on the correct compression call;
      // hashing a completed CV again would produce the wrong BLAKE3 digest.
      cv[0]=s0^s8;cv[1]=s1^s9;cv[2]=s2^s10;cv[3]=s3^s11;cv[4]=s4^s12;cv[5]=s5^s13;cv[6]=s6^s14;cv[7]=s7^s15;
    }

    const iv=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    // Native word views can read input directly only on little-endian hosts.
    const little=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;
    // Scratch belongs to this synchronous hasher instance. top below counts
    // stack WORDS (multiples of eight); 54 CVs cover BLAKE3's 64-bit byte domain.
    const cv=new Uint32Array(8),block=new Uint32Array(16),stack=new Uint32Array(54*8);
    return function blake3(data,end=data.length){
      // end is exclusive, allowing hashing the original bytes without copying
      // the buffer or including its appended digest. Views allocate per call,
      // never per 64-byte block; aligned full blocks use zero-copy word reads.
      const input=new DataView(data.buffer,data.byteOffset,end);
      const words=little&&!(data.byteOffset&3)?new Uint32Array(data.buffer,data.byteOffset,Math.floor(end/4)):null;
      // Empty input still compresses one empty block. A leaf can be ROOT only
      // when the entire message fits in that one chunk.
      const chunks=Math.max(1,Math.ceil(end/1024)),leafRoot=chunks===1?8:0;let top=0;
      for(let chunk=0;chunk<chunks;chunk++){
        cv.set(iv);
        // Chunk index is a 64-bit counter, split without truncating its high half.
        const lo=chunk>>>0,hi=Math.floor(chunk/4294967296);
        const begin=chunk*1024,limit=Math.min(begin+1024,end),blocks=Math.max(1,Math.ceil((limit-begin)/64));
        for(let b=0;b<blocks;b++){
          const pos=begin+b*64,len=Math.min(64,limit-pos);
          let source=words,offset=pos/4;
          if(!words||len<64){
            // Unaligned/big-endian input and partial blocks use explicit LE
            // loads. Clear stale tail bytes from earlier calls/parent blocks.
            block.fill(0);let j=0;
            for(;j+4<=len;j+=4)block[j>>>2]=input.getUint32(pos+j,true);
            for(;j<len;j++)block[j>>>2]|=data[pos+j]<<((j&3)*8);
            source=block;offset=0;
          }
          // Mark the real last block END even when it is a full 64 bytes.
          // Exact multiples never add an extra empty block or empty chunk.
          const flags=(b===0?1:0)|(b===blocks-1?2|leafRoot:0);
          compress(cv,source,offset,lo,hi,len,flags);
        }
        if(chunk===chunks-1){
          // Keep the final right CV, then fold outstanding left subtrees from
          // stack top to bottom. Save both CVs before resetting cv to the IV.
          while(top){
            top-=8;for(let i=0;i<8;i++){block[i]=stack[top+i];block[i+8]=cv[i];}
            // Parent input is left CV || right CV, counter 0, length 64.
            // Only the last parent receives ROOT.
            cv.set(iv);compress(cv,block,0,0,0,64,4|(top===0?8:0));
          }
        }else{
          // Each trailing zero in the completed-chunk count closes a subtree.
          // Merge with its left sibling before pushing the resulting CV.
          let count=chunk+1;
          while(count%2===0){
            top-=8;for(let i=0;i<8;i++){block[i]=stack[top+i];block[i+8]=cv[i];}
            // Arithmetic division preserves counts beyond 32-bit bitwise range.
            cv.set(iv);compress(cv,block,0,0,0,64,4);count/=2;
          }
          stack.set(cv,top);top+=8;
        }
      }
      // Explicit LE output also works on big-endian hosts. A fresh digest
      // buffer prevents subsequent scratch reuse from changing prior results.
      const result=new Uint8Array(32),out=new DataView(result.buffer);
      for(let i=0;i<8;i++)out.setUint32(i*4,cv[i],true);
      return result;
    };
  }

  // Decode body pairs into stored bytes, restoring XOR as words are written.
  // carry holds bits already read but not yet emitted; bits stays in 0..7.
  // Incoming 31/32 bits plus that residue conceptually need at most 39 bits.
  // We keep the low 32 in word and recover the overflow from the original value.
  function unpack(text,start,length,maskByte,verifyFormat,checkLength){
    // Replicate the byte mask once; unmasking costs one XOR per output word,
    // with no extra pass over the decoded byte buffer.
    const mask=(maskByte*0x01010101)|0;
    const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);
    let carry=0,bits=0,at=0,word=0,last=0;
    for(let i=start;i<text.length;i+=2){
      const x=table[text.charCodeAt(i)],y=table[text.charCodeAt(i+1)];
      if(verifyFormat&&(!x||!y))throw Error('Invalid payload character');
      // Undo the lookup's +1 sentinel and combine two base-R digits.
      const value=x-1+radix*(y-1);
      word=carry|(value<<bits);
      const output=word^mask;
      // Four-byte writes may speculatively include an incomplete fourth byte.
      // The next iteration overwrites it when only three bytes are committed.
      // At the buffer end use indexed stores: excess writes are ignored,
      // whereas an out-of-range DataView.setUint32 would throw.
      if(at+4<=length)view.setUint32(at,output,true);
      else{bytes[at]=output;bytes[at+1]=output>>>8;bytes[at+2]=output>>>16;bytes[at+3]=output>>>24;}
      // The same low-31-bit test as the encoder recovers this pair's bit width.
      const narrow=(value&0x7fffffff)>threshold;
      if(bits===0&&narrow){
        // With no prior residue, 31 bits provide only three complete bytes.
        // Keep the remaining seven bits for the next pair.
        carry=word>>>24;bits=7;last=3;
      }else{
        // Otherwise there are at least 32 bits: commit four bytes and retain
        // the high bits that the JS left shift above intentionally truncated.
        // Guard bits=0 because JS shifts by 32 actually shift by zero.
        carry=bits?value>>>(32-bits):0;bits-=narrow;last=4;
      }
      at+=last;
    }
    // Number of declared bytes used in the final word (normally 1..4).
    // word/carry remain MASKED transport bits, whose unused padding must be
    // zero; checking output instead would incorrectly inspect restored XOR.
    const used=length-at+last;
    // Integrity-only mode still rejects truncated bodies instead of accepting
    // the Uint8Array allocation's implicit zero fill as supplied input bytes.
    if(checkLength&&at<length)throw Error('Invalid payload length');
    if(verifyFormat){
      // Reject redundant pairs as well as nonzero bits beyond declared data.
      if(text.length>start&&used<=0)throw Error('Invalid payload length');
      if(carry||(used<4&&(word>>>(8*used))))throw Error('Invalid payload padding');
    }
    return bytes;
  }

  // The only public function; helpers and lazy hash scratch stay private.
  return function binary(text,{verifyFormat=true,verifyData='none',legacy=false}={}){
    // Policy is an exact mode requirement, not automatic hash negotiation.
    // Keeping kind checks independent of format checks prevents downgrades.
    const policy=verifyData===false||verifyData==='none'?0:verifyData===true||verifyData==='fast'?1:verifyData==='secure'?2:-1;
    if(policy<0)throw Error('verifyData must be none, fast or secure');
    if(verifyFormat){
      if(text.length<2)throw Error('Invalid payload length');
    }
    // Stored alphabet indices are +1; subtract that sentinel after validation.
    const a=table[text.charCodeAt(0)],b=table[text.charCodeAt(1)];
    if(verifyFormat&&(!a||!b))throw Error('Invalid payload character');
    // Short header: 10 mode bits + length quotient, then length remainder.
    // Long header: 32768 + mode, remainder, quotient. Mode: hash(2) | XOR(8).
    // Length includes any digest. All arithmetic remains exact JS integers.
    const first=a-1;let length,start=2,mode=0;
    // Format 1 reverses the digit order and has neither mask nor hash trailer.
    if(legacy)length=first+radix*(b-1);
    else{
      mode=first&1023;
      if(first<32768)length=(first>>>10)*radix+b-1;
      else if(first<33792||!verifyFormat){
        if(verifyFormat&&text.length<3)throw Error('Invalid payload length');
        const c=table[text.charCodeAt(2)];
        if(verifyFormat&&!c)throw Error('Invalid payload character');
        start=3;length=b-1+radix*(c-1);
        // Require the shortest header representation when checking format.
        if(verifyFormat&&length<32*radix)throw Error('Invalid payload header');
      }else throw Error('Invalid payload header');
    }
    // Kind 3 is reserved. Hash trailers are four LE bytes or a 32-byte digest.
    const kind=mode>>>8,mask=mode&255,digestLength=kind===1?4:kind===2?32:0;
    const checkLength=verifyFormat||policy;
    if(verifyFormat&&(kind===3||(text.length-start)%2||length<digestLength))throw Error('Invalid payload length');
    // Before allocating, each two-symbol pair can supply at most four bytes.
    // Keep the minimum-capacity check for integrity-only verification too.
    if(checkLength&&length>(text.length-start)*2)throw Error('Invalid payload length');
    if(policy&&(kind!==policy||length<digestLength))throw Error('Required payload integrity mode missing');
    // Mask restoration is unconditional, including when both checks are off.
    const bytes=unpack(text,start,length,mask,verifyFormat,checkLength);
    if(digestLength){
      // Hash only original, unmasked data; header/text/XOR metadata is outside
      // the digest. Format verification handles their structural constraints.
      const end=length-digestLength;
      if(policy===1){
        const stored=new DataView(bytes.buffer).getUint32(end,true);
        if(xxhash32(bytes,end)!==stored)throw Error('Payload checksum mismatch');
      }else if(policy===2){
        const digest=(secureHash||(secureHash=createBlake3()))(bytes,end);
        // Visit all digest bytes rather than stopping at the first mismatch.
        // JavaScript engines do not guarantee constant-time execution.
        let difference=0;for(let i=0;i<32;i++)difference|=digest[i]^bytes[end+i];
        if(difference)throw Error('Payload digest mismatch');
      }
      // Strip the stored trailer even when verification is skipped. subarray
      // shares the output allocation and avoids a second payload-sized copy.
      return bytes.subarray(0,end);
    }
    return bytes;
  };
})();
