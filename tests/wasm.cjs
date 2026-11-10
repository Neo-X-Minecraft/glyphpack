/* Exact JS/Wasm parity over valid, malformed, warmed and arena-reuse cases. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),vectors=JSON.parse(fs.readFileSync(path.join(root,'generated/test-vectors.json')));
const {execFileSync}=require('node:child_process');
const artifact=process.argv[2]?.endsWith('.wasm')?process.argv[2]:path.join(root,'generated/wasm/profiles/f01-d012-m01-modern.wasm');
(async()=>{
 const runtime=fs.readFileSync(path.join(root,'src/decoder/wasm-runtime.js'),'utf8').replace(/PAYLOAD_(?:INCLUDE_FORMAT|CHECK_DATA|ALLOW_FAST|ALLOW_SECURE)/g,'true');
 const {runWasm}=await import('data:text/javascript;base64,'+Buffer.from(runtime).toString('base64'));
 const module=new WebAssembly.Module(fs.readFileSync(artifact)),api=new WebAssembly.Instance(module).exports;
 const source=fs.readFileSync(path.join(root,'tests/reference/full.js'),'utf8');
 const js=new Function(source+';return binary')();
 const wasm=(text,options={})=>runWasm(api,text,options.verifyFormat??true,{none:0,fast:1,secure:2}[options.verifyData??'secure'],options.memoryHeavy??false);
 const call=(fn,text,options)=>{try{const b=fn(text,options);return{bytes:Buffer.from(b),offset:b.byteOffset,length:b.buffer.byteLength};}catch(e){return{error:e.message};}};
 let comparisons=0,roundTrips=0;
 const check=(text,options,expected)=>{
  const a=call(js,text,options),b=call(wasm,text,options);assert.deepEqual(b,a,JSON.stringify({options,text:text.slice(0,6)}));comparisons++;
  if(expected){assert(!b.error,b.error);assert(b.bytes.equals(Buffer.from(expected,'hex')));roundTrips++;}
 };
 for(const row of vectors.rows)for(const memoryHeavy of[false,true])for(const verifyFormat of[false,true])for(const verifyData of['none','fast','secure'])check(row.packets[verifyData],{memoryHeavy,verifyFormat,verifyData},row.rawHex);
 // Exercise every official BLAKE3 size through the actual SIMD verifier, not
 // only the native encoder or the frozen JS oracle. Fixed mask avoids spending
 // time searching masks; the existing fixture matrix covers mask restoration.
 const official=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/blake3-vectors.json')));
 const cli=process.env.GLYPHPACK_BIN||path.join(root,'target/release/glyphpack');
 for(const row of official.cases){
  const data=Buffer.from(Uint8Array.from({length:row.input_len},(_,i)=>i%251));
  const text=execFileSync(cli,['encode','-','--checksum','secure','--mask','0','--text'],{input:data,encoding:'utf8'});
  for(const memoryHeavy of[false,true])for(const verifyFormat of[false,true])check(text,{memoryHeavy,verifyFormat,verifyData:'secure'},data.toString('hex'));
 }
 const prefix=(...digits)=>String.fromCharCode(...digits.map(i=>vectors.alphabet[i]));
 // Tiny malformed headers must not allocate an output arena or the heavy table.
 const fresh=new WebAssembly.Instance(module).exports;
 runWasm(fresh,vectors.zero.none,false,0,false);
 const initialMemory=fresh.memory.buffer.byteLength;
 for(const text of [prefix(512),prefix(32768,1048576%63385,Math.floor(1048576/63385))]){
  assert.throws(()=>runWasm(fresh,text,false,0,true),/Invalid payload length/);
  assert.equal(fresh.memory.buffer.byteLength,initialMemory);
 }

 const bad=['',prefix(512),prefix(32768+512,0),prefix(32768,1048576%63385,Math.floor(1048576/63385))];
 for(const memoryHeavy of[false,true])for(const verifyFormat of[false,true])for(const verifyData of['none','fast','secure'])for(const text of bad)check(text,{memoryHeavy,verifyFormat,verifyData});
 let seed=333;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let n=0;n<60000;n++){
  const row=vectors.rows[random(vectors.rows.length)],mode=['none','fast','secure'][random(3)],options={verifyFormat:!!random(2),verifyData:mode,memoryHeavy:!!random(2)};let text=row.packets[mode];
  switch(random(5)){case 0:text=text.slice(0,random(text.length+1));break;case 1:text+='  ';break;default:{const at=random(text.length);text=text.slice(0,at)+String.fromCharCode(random(65536))+text.slice(at+1);}}
  check(text,options);
 }
 for(const row of vectors.extended)for(const memoryHeavy of[false,true])for(const verifyFormat of[false,true])for(const verifyData of['none','fast','secure']){
  const options={memoryHeavy,verifyFormat,verifyData};check(row.packets[verifyData],options);const bytes=wasm(row.packets[verifyData],options);assert.equal(bytes.length,row.size);assert(bytes.every(x=>x===255));roundTrips++;
 }
 // A malformed unchecked packet may leave a tail uncovered. Reused native
 // output arenas must still return the same implicit zero bytes as fresh JS.
 for(const length of[1,31,32,255,4097])for(const verifyFormat of[false,true]){
  wasm(vectors.zero.none,{verifyData:'none',memoryHeavy:true});
  check(prefix(0,length)+' '.repeat(Math.ceil(length/4)*2),{verifyFormat,verifyData:'none',memoryHeavy:true});
 }
 console.log(JSON.stringify({pass:true,comparisons,roundTrips,officialKernelCases:official.cases.length,fullCombinations:12,wasmBytes:fs.statSync(artifact).size,arenaReuse:true,exactErrorsAndBufferShape:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
