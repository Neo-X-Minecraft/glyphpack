/* Dense BMP decoder. The private lookup is initialized once per page. */
const binary=(()=>{
  const table=new Uint16Array(65536);let radix=0;
  for(let c=32;c<65534;c++){
    if(c===60||(c>=127&&c<=159)||(c>=55296&&c<=57343)||(c>=64976&&c<=65007)||c===65279||c===8232||c===8233)continue;
    table[c]=++radix;
  }
  // Zero marks an invalid symbol; valid indices are stored plus one.
  const threshold=radix*radix-2147483649;
  return function binary(text,{verify='auto',legacy=false}={}){
    if(text.length<2)throw Error('Invalid payload length');
    const a=table[text.charCodeAt(0)],b=table[text.charCodeAt(1)];
    if(!a||!b)throw Error('Invalid payload character');
    const first=a-1;let length,start=2,mode=0;
    if(legacy)length=first+radix*(b-1);
    else{
      mode=first&511;
      if(first<32768)length=(first>>>9)*radix+b-1;
      else if(first<33280){
        const c=table[text.charCodeAt(2)];if(!c)throw Error('Invalid payload character');
        start=3;length=b-1+radix*(c-1);
        if(length<64*radix)throw Error('Invalid payload header');
      }else throw Error('Invalid payload header');
    }
    const checksum=!!(mode&256),mask=(mode&255)*0x01010101;
    if((text.length-start)%2||length>(text.length-start)*2||(checksum&&length<4))throw Error('Invalid payload length');
    if(verify===true&&!checksum)throw Error('Payload checksum required');
    const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);
    let carry=0,bits=0,at=0,word=0,last=0;
    for(let i=start;i<text.length;i+=2){
      const x=table[text.charCodeAt(i)],y=table[text.charCodeAt(i+1)];
      if(!x||!y)throw Error('Invalid payload character');
      const value=x-1+radix*(y-1);
      word=carry|(value<<bits);
      const output=word^mask;
      if(at+4<=length)view.setUint32(at,output,true);
      else{bytes[at]=output;bytes[at+1]=output>>>8;bytes[at+2]=output>>>16;bytes[at+3]=output>>>24;}
      const narrow=(value&0x7fffffff)>threshold;
      if(bits===0&&narrow){
        carry=word>>>24;bits=7;last=3;
      }else{
        carry=bits?value>>>(32-bits):0;bits-=narrow;last=4;
      }
      at+=last;
    }
    const used=length-at+last;
    if(at<length||(text.length>start&&used<=0))throw Error('Invalid payload length');
    if(carry||(used<4&&(word>>>(8*used))))throw Error('Invalid payload padding');
    if(checksum){
      const end=length-4;
      if(verify!==false){
        if(!binary.crc32)throw Error('Checksum verifier not loaded');
        if(binary.crc32(bytes,end)!==view.getUint32(end,true))throw Error('Payload checksum mismatch');
      }
      return bytes.subarray(0,end);
    }
    return bytes;
  };
})();
