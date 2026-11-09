/* Differential correctness only. Browser timings are measured in Chromium 156. */
const fs=require('fs'),crypto=require('crypto'),{execFileSync}=require('child_process');
const root=require('path').resolve(__dirname,'..');fs.mkdirSync(root+'/generated/results',{recursive:true});
function decoder(path){return new Function(fs.readFileSync(path,'utf8')+';return binary;')();}
const compiled=require('./payload_test_tools.js');
(async()=>{
const current=await compiled.decoder(),fast=await compiled.decoder({legacy:true,verifyData:'none'});
const old=decoder(root+'/tests/fixtures/payload-codec-float.js'),registers=decoder(root+'/tests/fixtures/payload-codec-registers.js');
const alphabet=[];for(let c=32;c<65534;c++)if(!(c===60||(c>=127&&c<=159)||(c>=55296&&c<=57343)||(c>=64976&&c<=65007)||c===65279||c===8232||c===8233))alphabet.push(c);
function encode(data){
  const radix=alphabet.length,threshold=BigInt(radix*radix-2147483649),chars=[alphabet[data.length%radix],alphabet[Math.floor(data.length/radix)]];
  let queue=0n,bits=0;
  for(const byte of data){queue|=BigInt(byte)<<BigInt(bits);bits+=8;
    while(bits>=32){let value=queue&2147483647n;if(value>threshold){queue>>=31n;bits-=31;}else{value=queue&4294967295n;queue>>=32n;bits-=32;}
      const v=Number(value);chars.push(alphabet[v%radix],alphabet[Math.floor(v/radix)]);}}
  if(bits){const v=Number(queue);chars.push(alphabet[v%radix],alphabet[Math.floor(v/radix)]);}
  const out=Buffer.allocUnsafe(chars.length*2);chars.forEach((c,i)=>out.writeUInt16LE(c,i*2));return out.toString('utf16le');
}
const cases=[];
for(let size=0;size<=128;size++)cases.push(crypto.randomBytes(size));
for(const size of [255,256,257,4095,4096,4097,65535,65536,65537,1048576])for(const value of [0,255,-1])cases.push(value<0?crypto.randomBytes(size):Buffer.alloc(size,value));
for(const data of cases){let text=encode(data);if([old,fast,registers].some(fn=>!Buffer.from(fn(text)).equals(data)))throw Error('Differential failure at '+data.length);}
let rejectionCases=0;
function rejected(text,message='Invalid payload character'){let threw=false;try{fast(text);}catch(error){threw=error.message===message;}if(!threw)throw Error('Malformed input accepted: '+message);rejectionCases++;}
const valid=encode(Buffer.from([0,0,0,128])),allowed=new Set(alphabet);
for(let c=0;c<65536;c++)if(!allowed.has(c)){
  const bad=String.fromCharCode(c);
  rejected(bad+valid.slice(1));rejected(valid.slice(0,2)+bad+valid.slice(3));
}
for(const text of ['',valid.slice(0,1),valid.slice(0,-1)])rejected(text,'Invalid payload length');
for(const index of [0,1,2,3])rejected(valid.slice(0,index)+'<'+valid.slice(index+1));
const beforeStructural=rejectionCases,pair=v=>String.fromCharCode(alphabet[v%alphabet.length],alphabet[Math.floor(v/alphabet.length)]);
for(const data of cases){
  const text=encode(data);
  if(data.length){
    rejected(text.slice(0,2),'Invalid payload length');
    rejected(text.slice(0,-2),'Invalid payload length');
    if(data.length<=128)for(let end=2;end<text.length;end+=2)rejected(text.slice(0,end),'Invalid payload length');
  }
  rejected(text+pair(0),'Invalid payload length');
}
rejected(pair(alphabet.length**2-1),'Invalid payload length');
for(const value of [256,65536,16777216])rejected(pair(1)+pair(value),'Invalid payload padding');
rejected(pair(4)+pair(2147483647)+pair(33554432),'Invalid payload padding');
const structuralRejections=rejectionCases-beforeStructural;
const cached=await compiled.decoder({legacy:true,verifyData:'none'});
for(let i=0;i<10;i++)if(!Buffer.from(cached(valid)).equals(Buffer.from([0,0,0,128])))throw Error('Repeated decode mismatch');
const productionInputs=[Buffer.alloc(0),Buffer.from([255]),Buffer.from([0,0,0,128]),Buffer.from(Array.from({length:256},(_,i)=>i)),crypto.randomBytes(4096)];
for(const data of productionInputs){
  const text=execFileSync(process.env.GLYPHPACK_BIN,['encode','--legacy','--checksum','none'],{input:data}).toString('utf16le');
  if(text!==encode(data)||!Buffer.from(fast(text)).equals(data))throw Error('Production encoder mismatch');
  const modern=execFileSync(process.env.GLYPHPACK_BIN,['encode'],{input:data}).toString('utf16le');
  if(!Buffer.from(current(modern)).equals(data))throw Error('Adaptive encoder mismatch');
}
const report={pass:true,node:process.version,correctnessCases:cases.length,rejectionCases,structuralRejections,productionEncoderCases:productionInputs.length,realPayloads:[]};
// Large legacy/modern boundaries are covered above; no private asset fixtures.
fs.writeFileSync(root+'/generated/results/payload-decoder-unit-qa.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

})().catch(error=>{console.error(error);process.exitCode=1;});
