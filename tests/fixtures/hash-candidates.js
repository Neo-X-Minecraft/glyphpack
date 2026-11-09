/* Benchmark alternatives; production keeps only the selected fast checksum. */
let crcTables;
function crcTablesInit(){
  if(crcTables)return crcTables;
  crcTables=new Uint32Array(2048);
  for(let i=0;i<256;i++){
    let c=i;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);crcTables[i]=c;
  }
  for(let s=1;s<8;s++)for(let i=0;i<256;i++){
    const v=crcTables[(s-1)*256+i];crcTables[s*256+i]=crcTables[v&255]^(v>>>8);
  }
  return crcTables;
}
function crc32(data,end=data.length){
  const t=crcTablesInit();let c=-1;
  for(let i=0;i<end;i++)c=t[(c^data[i])&255]^(c>>>8);
  return(c^-1)>>>0;
}
function crc32Slice8(data,end=data.length){
  const t=crcTablesInit(),v=new DataView(data.buffer,data.byteOffset,end);let c=-1,i=0;
  for(;i+8<=end;i+=8){
    const a=v.getUint32(i,true)^c,b=v.getUint32(i+4,true);
    c=t[1792+(a&255)]^t[1536+((a>>>8)&255)]^t[1280+((a>>>16)&255)]^t[1024+(a>>>24)]^t[768+(b&255)]^t[512+((b>>>8)&255)]^t[256+((b>>>16)&255)]^t[b>>>24];
  }
  for(;i<end;i++)c=t[(c^data[i])&255]^(c>>>8);
  return(c^-1)>>>0;
}
function murmur3(data,end=data.length){
  const v=new DataView(data.buffer,data.byteOffset,end);let h=0,i=0,k=0;
  for(;i+4<=end;i+=4){
    k=Math.imul(v.getUint32(i,true),0xcc9e2d51);k=(k<<15)|(k>>>17);k=Math.imul(k,0x1b873593);
    h^=k;h=(h<<13)|(h>>>19);h=(Math.imul(h,5)+0xe6546b64)|0;
  }
  k=0;switch(end-i){case 3:k=data[i+2]<<16;case 2:k|=data[i+1]<<8;case 1:k|=data[i];k=Math.imul(k,0xcc9e2d51);k=(k<<15)|(k>>>17);h^=Math.imul(k,0x1b873593);}
  h^=end;h^=h>>>16;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;
  return h>>>0;
}
function xxhash32(data,end=data.length){
  const v=new DataView(data.buffer,data.byteOffset,end);let i=0,h;
  if(end>=16){
    let a=0x24234428,b=0x85ebca77|0,c=0,d=-0x9e3779b1|0;
    for(;i+16<=end;i+=16){
      a=(a+Math.imul(v.getUint32(i,true),0x85ebca77))|0;a=Math.imul((a<<13)|(a>>>19),0x9e3779b1);
      b=(b+Math.imul(v.getUint32(i+4,true),0x85ebca77))|0;b=Math.imul((b<<13)|(b>>>19),0x9e3779b1);
      c=(c+Math.imul(v.getUint32(i+8,true),0x85ebca77))|0;c=Math.imul((c<<13)|(c>>>19),0x9e3779b1);
      d=(d+Math.imul(v.getUint32(i+12,true),0x85ebca77))|0;d=Math.imul((d<<13)|(d>>>19),0x9e3779b1);
    }
    h=((a<<1)|(a>>>31))+((b<<7)|(b>>>25))+((c<<12)|(c>>>20))+((d<<18)|(d>>>14));
  }else h=0x165667b1;
  h=(h+end)|0;
  for(;i+4<=end;i+=4){h=(h+Math.imul(v.getUint32(i,true),0xc2b2ae3d))|0;h=Math.imul((h<<17)|(h>>>15),0x27d4eb2f);}
  for(;i<end;i++){h=(h+Math.imul(data[i],0x165667b1))|0;h=Math.imul((h<<11)|(h>>>21),0x9e3779b1);}
  h^=h>>>15;h=Math.imul(h,0x85ebca77);h^=h>>>13;h=Math.imul(h,0xc2b2ae3d);h^=h>>>16;return h>>>0;
}
