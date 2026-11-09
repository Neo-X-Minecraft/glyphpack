/* Dense BMP decoder. The private lookup is initialized once per page. */
const binary=(()=>{
  const table=new Uint16Array(65536);let radix=0;
  for(let c=32;c<65534;c++){
    if(c===60||(c>=127&&c<=159)||(c>=55296&&c<=57343)||(c>=64976&&c<=65007)||c===65279||c===8232||c===8233)continue;
    table[c]=++radix;
  }
  // Zero marks an invalid symbol; valid indices are stored plus one.
  const threshold=radix*radix-2147483649;
  return function binary(text){
    if(text.length<2||text.length%2)throw Error('Invalid payload length');
    const a=table[text.charCodeAt(0)],b=table[text.charCodeAt(1)];
    if(!a||!b)throw Error('Invalid payload character');
    const length=a-1+radix*(b-1);
    if(length>(text.length-2)*2)throw Error('Invalid payload length');
    const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);
    let carry=0,bits=0,at=0,word=0,last=0;
    for(let i=2;i<text.length;i+=2){
      const x=table[text.charCodeAt(i)],y=table[text.charCodeAt(i+1)];
      if(!x||!y)throw Error('Invalid payload character');
      const value=x-1+radix*(y-1);
      word=carry|(value<<bits);
      if(at+4<=length)view.setUint32(at,word,true);
      else{bytes[at]=word;bytes[at+1]=word>>>8;bytes[at+2]=word>>>16;bytes[at+3]=word>>>24;}
      const narrow=(value&0x7fffffff)>threshold;
      if(bits===0&&narrow){
        carry=word>>>24;bits=7;last=3;
      }else{
        carry=bits?value>>>(32-bits):0;bits-=narrow;last=4;
      }
      at+=last;
    }
    const used=length-at+last;
    if(at<length||(text.length>2&&used<=0))throw Error('Invalid payload length');
    if(carry||(used<4&&(word>>>(8*used))))throw Error('Invalid payload padding');
    return bytes;
  };
})();
