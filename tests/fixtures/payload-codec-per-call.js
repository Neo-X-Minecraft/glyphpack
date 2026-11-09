/* Checked unrolled decoder with per-call initialization, for benchmarks. */
function binary(text){
  const alphabet=[];
  for(let c=32;c<65534;c++){
    if(c===60||(c>=127&&c<=159)||(c>=55296&&c<=57343)||(c>=64976&&c<=65007)||c===65279||c===8232||c===8233)continue;
    alphabet.push(c);
  }
  const radix=alphabet.length,table=new Uint16Array(65536);
  // Zero marks an invalid symbol; alphabet index zero is stored as one.
  alphabet.forEach((c,i)=>table[c]=i+1);
  const threshold=radix*radix-2147483649;

    if(text.length<2||text.length%2)throw Error('Invalid payload length');
    function pair(i){
      const a=table[text.charCodeAt(i)],b=table[text.charCodeAt(i+1)];
      if(!a||!b)throw Error('Invalid payload character');
      return a+radix*b-radix-1;
    }
    const length=pair(0);
    if(length>(text.length-2)*2)throw Error('Invalid payload length');
    const bytes=new Uint8Array(length);
    let queue=0,bits=0,at=0,word=0,total=0;
    for(let i=2;i<text.length;i+=2){
      const value=pair(i);
      word=queue|(value<<bits);total=bits+((value&0x7fffffff)>threshold?31:32);
      bytes[at++]=word&255;bytes[at++]=(word>>>8)&255;bytes[at++]=(word>>>16)&255;
      if(total>=32){
        bytes[at++]=word>>>24;
        queue=bits?value>>>(32-bits):0;
        bits=total-32;
      }else{
        queue=word>>>24;bits=total-24;
      }
    }
    const used=length-at+(total>>>3);
    if(at<length||(text.length>2&&used<=0))throw Error('Invalid payload length');
    if(queue||(used<4&&(word>>>(8*used))))throw Error('Invalid payload padding');
    return bytes;
}
