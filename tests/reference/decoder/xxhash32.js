// XXH32, seed zero, over data[0..end). No table is needed. This fast 32-bit
// check detects accidental changes; it does not provide collision resistance.
export function xxhash32(data,end=data.length){
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
