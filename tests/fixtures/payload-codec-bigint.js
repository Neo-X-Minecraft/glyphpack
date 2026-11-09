/* BigInt reference decoder for browser performance comparisons. */
const binary=(()=>{
  const table=new Uint16Array(65536);let radix=0;
  for(let c=32;c<65534;c++){
    if(c===60||(c>=127&&c<=159)||(c>=55296&&c<=57343)||(c>=64976&&c<=65007)||c===65279||c===8232||c===8233)continue;
    table[c]=++radix;
  }
  const threshold=radix*radix-2147483649;
  return function binary(text){
    function pair(i){const a=table[text.charCodeAt(i)],b=table[text.charCodeAt(i+1)];if(!a||!b)throw Error('Invalid payload character');return a-1+radix*(b-1);}
    const bytes=new Uint8Array(pair(0));let queue=0n,bits=0,at=0;
    for(let i=2;i<text.length;i+=2){
      const value=pair(i);queue|=BigInt(value)<<BigInt(bits);bits+=(value&0x7fffffff)>threshold?31:32;
      while(bits>=8){bytes[at++]=Number(queue&255n);queue>>=8n;bits-=8;}
    }
    return bytes;
  };
})();
