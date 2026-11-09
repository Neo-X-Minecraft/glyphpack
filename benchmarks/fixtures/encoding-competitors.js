/* Test-only optimized, portable JS competitors. These remain outside the
 * production codec. All entry points consume an encoded string and allocate a
 * Uint8Array; no output-buffer reuse or externally supplied byte length.
 */
const illegal122=[0,10,13,34,38,92];
const illegal121=[0,10,13,34,38,92,60];

// Inline one or two 7-bit groups per character. At most 21 queued bits are live,
// so signed JS shifts safely drop only already-emitted high bits.
export function inline122(text,illegal=illegal122){
  const n=text.length,out=new Uint8Array(Math.floor(n*1.75));
  let queue=0,bits=0,at=0;
  for(let i=0;i<n;i++){
    const c=text.charCodeAt(i);
    if(c<128){queue=(queue<<7)|c;bits+=7;}
    else{
      const index=(c>>>8)&7;
      if(index!==7){queue=(queue<<14)|(illegal[index]<<7)|(c&127);bits+=14;}
      else{queue=(queue<<7)|(c&127);bits+=7;}
    }
    if(bits>=8){bits-=8;out[at++]=queue>>>bits;if(bits>=8){bits-=8;out[at++]=queue>>>bits;}}
  }
  return out.subarray(0,at);
}
export const inline121=text=>inline122(text,illegal121);

// Eight ordinary ASCII groups map directly to seven bytes. Escapes retain the
// scalar path, including shortened final escapes. This is screened against the
// simple inline version; the extra lookahead can lose on escape-heavy inputs.
export function block122(text,illegal=illegal122){
  const n=text.length,out=new Uint8Array(Math.floor(n*1.75));
  let queue=0,bits=0,at=0,i=0;
  while(i<n){
    if(bits===0&&i+8<=n){
      const a=text.charCodeAt(i),b=text.charCodeAt(i+1),c=text.charCodeAt(i+2),d=text.charCodeAt(i+3),e=text.charCodeAt(i+4),f=text.charCodeAt(i+5),g=text.charCodeAt(i+6),h=text.charCodeAt(i+7);
      if((a|b|c|d|e|f|g|h)<128){
        out[at]=a<<1|b>>>6;out[at+1]=b<<2|c>>>5;out[at+2]=c<<3|d>>>4;
        out[at+3]=d<<4|e>>>3;out[at+4]=e<<5|f>>>2;out[at+5]=f<<6|g>>>1;out[at+6]=g<<7|h;
        at+=7;i+=8;queue=0;continue;
      }
    }
    const c=text.charCodeAt(i++);
    if(c<128){queue=(queue<<7)|c;bits+=7;}
    else{const index=(c>>>8)&7;if(index!==7){queue=(queue<<14)|(illegal[index]<<7)|(c&127);bits+=14;}else{queue=(queue<<7)|(c&127);bits+=7;}}
    if(bits>=8){bits-=8;out[at++]=queue>>>bits;if(bits>=8){bits-=8;out[at++]=queue>>>bits;}}
  }
  return out.subarray(0,at);
}
export const block121=text=>block122(text,illegal121);

// Exact sizing trades an extra character scan for a smaller output allocation.
export function counted122(text){
  let groups=text.length;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);if(c>127&&((c>>>8)&7)!==7)groups++;}
  const out=new Uint8Array(Math.floor(groups*7/8));let queue=0,bits=0,at=0;
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    if(c<128){queue=(queue<<7)|c;bits+=7;}
    else{const index=(c>>>8)&7;if(index!==7){queue=(queue<<14)|(illegal122[index]<<7)|(c&127);bits+=14;}else{queue=(queue<<7)|(c&127);bits+=7;}}
    if(bits>=8){bits-=8;out[at++]=queue>>>bits;if(bits>=8){bits-=8;out[at++]=queue>>>bits;}}
  }
  return out;
}

// Ascii85 without z/y abbreviations: contiguous digits avoid an inverse table.
// All complete 5-character groups fit an exact 32-bit unsigned output word.
export function ascii85(text){
  const n=text.length,length=Math.floor(n*4/5),out=new Uint8Array(length),view=new DataView(out.buffer);
  let i=0,at=0;
  for(;i+5<=n;i+=5,at+=4){
    const value=((((text.charCodeAt(i)-33)*85+text.charCodeAt(i+1)-33)*85+text.charCodeAt(i+2)-33)*85+text.charCodeAt(i+3)-33)*85+text.charCodeAt(i+4)-33;
    view.setUint32(at,value,false);
  }
  if(i<n){let value=0;const remain=n-i;for(let j=0;j<5;j++)value=value*85+(j<remain?text.charCodeAt(i+j)-33:84);for(let j=0;j<remain-1;j++)out[at+j]=value>>>(24-j*8);}
  return out;
}
const z85Map=new Uint8Array(128);
const z85Alphabet='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#';
for(let i=0;i<85;i++)z85Map[z85Alphabet.charCodeAt(i)]=i;
export function z85(text){
  const n=text.length,length=Math.floor(n*4/5),out=new Uint8Array(length),view=new DataView(out.buffer),m=z85Map;
  let i=0,at=0;
  for(;i+5<=n;i+=5,at+=4){const value=(((m[text.charCodeAt(i)]*85+m[text.charCodeAt(i+1)])*85+m[text.charCodeAt(i+2)])*85+m[text.charCodeAt(i+3)])*85+m[text.charCodeAt(i+4)];view.setUint32(at,value,false);}
  if(i<n){let value=0;const remain=n-i;for(let j=0;j<5;j++)value=value*85+(j<remain?m[text.charCodeAt(i+j)]:84);for(let j=0;j<remain-1;j++)out[at+j]=value>>>(24-j*8);}
  return out;
}
export function nativeAtob(text){
  const raw=atob(text),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;
}
