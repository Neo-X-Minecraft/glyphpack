/* Decoder regressions run in JS so integer/coercion/view semantics match the
 * browser. Rust supplies encoded inputs and compiled profile sources only. */
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),v=JSON.parse(fs.readFileSync(process.argv[2]||path.join(root,'generated/test-vectors.json')));
const make=async source=>(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).binary;
(async()=>{
const fullSource=v.profiles.find(p=>p.formats.length===2&&p.modes.length===3&&p.memories.length===2).source;
let roundTrips=0,rejections=0,comparisons=0;
const header=(kind,length,mask=0)=>String.fromCharCode(v.alphabet[kind*256+mask],v.alphabet[length]);
const longHeader=n=>String.fromCharCode(v.alphabet[32768],v.alphabet[n%63385],v.alphabet[Math.floor(n/63385)]);
const malformed=['',String.fromCharCode(v.alphabet[512]),String.fromCharCode(v.alphabet[32768+512],v.alphabet[0]),longHeader(1048576),longHeader(63385**2-1),longHeader(1048576)+'  '];
for(const p of v.profiles){
 const binary=await make(p.source),defaultMode=p.modes.at(-1);
 for(const row of v.rows)for(const verifyFormat of p.formats)for(const verifyData of p.modes)for(const memoryHeavy of p.memories){
  const out=binary(row.packets[verifyData],{verifyFormat,verifyData,memoryHeavy});
  assert(Buffer.from(out).equals(Buffer.from(row.rawHex,'hex')));roundTrips++;
 }
 assert(Buffer.from(binary(v.zero[defaultMode])).equals(Buffer.alloc(256)));
 for(const verifyFormat of p.formats)for(const verifyData of p.modes)for(const memoryHeavy of p.memories){
  const opts={verifyFormat,verifyData,memoryHeavy};
  for(const text of malformed){assert.throws(()=>binary(text,opts),/Invalid payload/);rejections++;}
  for(const [kind,size]of [[1,4],[2,32]])for(let n=0;n<size;n++){
   const text=header(kind,n)+' '.repeat(Math.ceil(n/4)*2);
   assert.throws(()=>binary(text,opts),e=>e.message==='Invalid payload length');rejections++;
  }
  const damaged=v.zero[verifyData].slice(0,2)+String.fromCharCode(v.alphabet[1])+v.zero[verifyData].slice(3);
  if(verifyData==='none')assert(!Buffer.from(binary(damaged,opts)).equals(Buffer.alloc(256)));
  else{
   assert.throws(()=>binary(damaged,opts),verifyData==='fast'?/checksum mismatch/:/digest mismatch/);
   assert.throws(()=>binary(v.zero.none,opts),/integrity mode missing/);rejections+=2;
  }
 }
 if(p.formats.length===2)assert.throws(()=>binary(v.zero[defaultMode],{verifyFormat:'false'}),/Unsupported format verification option/);
 if(p.memories.length===2)for(const memoryHeavy of ['false',null,0,1])assert.throws(()=>binary(v.zero[defaultMode],{memoryHeavy}),/Unsupported memory optimization option/);
 if(p.modes.length>1)for(const mode of ['none','fast','secure','unknown'])if(!p.modes.includes(mode))assert.throws(()=>binary(v.zero[defaultMode],{verifyData:mode}),/Unsupported data verification mode/);
 // Fixed axes ignore attempted overrides rather than silently weakening policy.
 if(p.modes.length===1&&defaultMode!=='none'){
  const text=v.zero[defaultMode].slice(0,2)+String.fromCharCode(v.alphabet[1])+v.zero[defaultMode].slice(3);
  assert.throws(()=>binary(text,{verifyData:'none'}),/mismatch/);
 }
 if(p.modes.includes('none'))for(const mode of ['none','fast','secure'])assert(Buffer.from(binary(v.zero[mode],{verifyData:'none'})).equals(Buffer.alloc(256)));
}
const full=await make(fullSource),baseline=new Function(v.baseline+';return binary')();
const call=(fn,text,options)=>{try{const b=fn(text,options);return {bytes:Buffer.from(b),offset:b.byteOffset,length:b.buffer.byteLength};}catch(e){return {error:e.message};}};
let seed=331;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let n=0;n<30000;n++){
 const row=v.rows[random(v.rows.length)],mode=['none','fast','secure'][random(3)],options={verifyFormat:!!random(2),verifyData:mode};let text=row.packets[mode];
 switch(random(5)){case 0:text=text.slice(0,random(text.length+1));break;case 1:text+='  ';break;default:{const at=random(text.length);text=text.slice(0,at)+String.fromCharCode(random(65536))+text.slice(at+1);}}
 const a=call(full,text,{...options,memoryHeavy:false}),b=call(full,text,{...options,memoryHeavy:true}),c=call(baseline,text,options);
 assert.deepEqual(a,b);assert.deepEqual(a,c);comparisons+=2;
}
for(const row of v.extended)for(const memoryHeavy of [false,true])for(const verifyFormat of [false,true])for(const verifyData of ['none','fast','secure']){
 const bytes=full(row.packets[verifyData],{memoryHeavy,verifyFormat,verifyData});assert.equal(bytes.length,row.size);assert(bytes.every(x=>x===255));roundTrips++;
}
// Format and byte integrity are separate contracts: skipped format checks may
// accept surplus symbols; hashing alone never authenticates encoded spelling.
assert(Buffer.from(full(v.zero.secure+'  ',{verifyFormat:false})).equals(Buffer.alloc(256)));
assert.throws(()=>full(v.zero.secure+'  '),/Invalid payload length/);
console.log(JSON.stringify({pass:true,profiles:v.profiles.length,allowedCombinations:192,roundTrips,rejections,comparisons,allocationSafety:true,wasmOnly:true,extendedHeaders:true}));

// Import-time compatibility failures are explicit; there is no decoder fallback.
const moduleSource=v.profiles[0].source;
for(const [name,message]of [['WebAssembly','WebAssembly is required'],['DecompressionStream','DecompressionStream is required']]){
 const original=globalThis[name];globalThis[name]=undefined;
 try{await assert.rejects(import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64')+'#missing-'+name),e=>e.message===message);}finally{globalThis[name]=original;}
}
})().catch(error=>{console.error(error);process.exitCode=1;});
