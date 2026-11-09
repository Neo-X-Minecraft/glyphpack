'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const vectors=JSON.parse(fs.readFileSync('tests/fixtures/blake3-vectors.json','utf8'));
const noble=vm.runInNewContext(fs.readFileSync('tests/vendor/hashes/noble-blake3.min.js','utf8')+';Blake3Noble.blake3',{Uint8Array,Uint32Array,DataView,ArrayBuffer,TextEncoder});
const wasm=require('./vendor/hashes/blake3.umd.min.js').blake3;
const hex=b=>Buffer.from(b).toString('hex');
(async()=>{
 let count=0;
 for(const variant of ['loop','loop-stop','unrolled','js-reference']){
  const source=variant==='js-reference'?fs.readFileSync('tests/reference/decoder/blake3.js','utf8').replace('export function createBlake3','function createBlake3')+';createBlake3()':fs.readFileSync('tests/fixtures/blake3-'+variant+'.js','utf8')+';blake3';
  const own=vm.runInNewContext(source,{Uint8Array,Uint32Array,Uint16Array,DataView,ArrayBuffer});
  for(const row of vectors.cases){
   const data=Uint8Array.from({length:row.input_len},(_,i)=>i%251),expected=row.hash.slice(0,64);
   assert.equal(hex(own(data)),expected,'official '+variant+' '+row.input_len);
   assert.equal(hex(noble(data)),expected);assert.equal(await wasm(data),expected);count++;
  }
  let state=123456789;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  for(const n of [...Array.from({length:130},(_,i)=>i),255,256,257,1023,1024,1025,2047,2048,2049,3072,4096,4097,7168,8191,8192,8193,65535,65536,65537,1048576]){
   for(const offset of [0,1,2,3]){
    const data=Uint8Array.from({length:n+offset+16},()=>random()&255).subarray(offset,offset+n),expect=hex(noble(data));
    assert.equal(hex(own(data)),expect,variant+' '+n+' offset '+offset);assert.equal(await wasm(data),expect);count++;
    if(n>4)assert.equal(hex(own(data,n-3)),hex(noble(data.subarray(0,n-3))));
   }
  }
  for(const n of [1048577,0,1,4097,63,64,65,0]){
   const data=Uint8Array.from({length:n},(_,i)=>(i*31+91)&255);
   assert.equal(hex(own(data)),hex(noble(data)),variant+' reused scratch '+n);count++;
  }
 }
 console.log(JSON.stringify({pass:true,cases:count,officialCases:vectors.cases.length,references:['official BLAKE3 vectors','Noble hashes 2.4.0','hash-wasm 4.13.0']}));
})().catch(e=>{console.error(e);process.exitCode=1;});
