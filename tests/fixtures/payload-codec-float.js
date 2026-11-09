/* Dense BMP encoding for BOM-marked UTF-16 HTML. No length-validation gates. */
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
    queue+=value*2**bits;bits+=value%2147483648>threshold?31:32;
    while(bits>=8){bytes[at++]=queue%256;queue=Math.floor(queue/256);bits-=8;}
  }
  return bytes;
}
