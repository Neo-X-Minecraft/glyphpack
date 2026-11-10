/* Dense BMP payload decoder, with a separate carry above the low 32 bits. */
function binary(text){
  const alphabet=[];
  for(let c=32;c<65534;c++){
    if(c===60||(c>=127&&c<=159)||(c>=55296&&c<=57343)||(c>=64976&&c<=65007)||c===65279||c===8232||c===8233)continue;
    alphabet.push(c);
  }
  const radix=alphabet.length,table=new Uint16Array(65536);
  alphabet.forEach((c,i)=>table[c]=i);
  const bytes=new Uint8Array(table[text.charCodeAt(0)]+radix*table[text.charCodeAt(1)]);
  const threshold=radix*radix-2147483649;
  let queue=0,bits=0,at=0;
  for(let i=2;i<text.length;i+=2){
    const value=table[text.charCodeAt(i)]+radix*table[text.charCodeAt(i+1)];
    const word=queue|(value<<bits),total=bits+((value&0x7fffffff)>threshold?31:32);
    bytes[at++]=word&255;bytes[at++]=(word>>>8)&255;bytes[at++]=(word>>>16)&255;
    if(total>=32){
      bytes[at++]=word>>>24;
      queue=bits?value>>>(32-bits):0;
      bits=total-32;
    }else{
      queue=word>>>24;bits=total-24;
    }
  }
  return bytes;
}
