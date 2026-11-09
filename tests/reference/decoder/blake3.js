// Unkeyed, one-shot BLAKE3-256 only. Private synchronous scratch is reused.
// This is cryptographic hashing, not keyed authentication; replacing both
// the original bytes and their digest is outside an unkeyed hash's guarantee.
// CHUNK_START=1, CHUNK_END=2, PARENT=4, ROOT=8.
export function createBlake3(){
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
      // Benchmark: benchmarks/results/blake3-permutation-recheck.json (project root).
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
