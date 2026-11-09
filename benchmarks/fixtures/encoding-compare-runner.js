/* Browser-only decode benchmark. Loading/encoding/DOM work is outside timers.
 * Candidate screening prevents a slow reference-only comparison: pick the
 * fastest correct measured JS implementation in each family before comparing
 * verification tiers with the exact same XXH32 and BLAKE3 verifier code.
 */
import {local,fork,alttiri,reference122,sheep} from '../../generated/encoding-comparison/competitors.mjs';
import {verify} from '../../generated/encoding-comparison/checks.mjs';
import {binary} from '../../dist/full.min.mjs';

const pool=[
  {id:'base64-atob',family:'Base64',input:'base64',fn:local.nativeAtob,source:'local native-atob adapter'},
  {id:'base122-reference',family:'Base122',input:'base122',fn:reference122,source:'kevinAlbs/Base122'},
  {id:'base122-fork',family:'Base122',input:'base122',fn:fork.decode,source:'code4fukui/Base122'},
  {id:'base122-inline',family:'Base122',input:'base122',fn:local.inline122,source:'local optimized JS'},
  {id:'base122-block',family:'Base122',input:'base122',fn:local.block122,source:'local optimized JS'},
  {id:'base122-counted',family:'Base122',input:'base122',fn:local.counted122,source:'local optimized JS'},
  {id:'base121-inline',family:'Base121',input:'base121',fn:local.inline121,source:'local < excluding extension'},
  {id:'base121-block',family:'Base121',input:'base121',fn:local.block121,source:'local < excluding extension'},
  {id:'base85-ascii-direct',family:'Base85',input:'ascii85',fn:local.ascii85,source:'local optimized JS'},
  {id:'base85-z85-direct',family:'Base85',input:'z85',fn:local.z85,source:'local optimized JS'},
  {id:'base85-alttiri-ascii',family:'Base85',input:'ascii85',fn:text=>alttiri.decode(text,'ascii85'),source:'AlttiRi/base85'},
  {id:'base85-alttiri-z85',family:'Base85',input:'z85',fn:text=>alttiri.decode(text,'z85'),source:'AlttiRi/base85'},
  {id:'base85-sheep-ascii',family:'Base85',input:'ascii85',fn:text=>sheep.Ascii85Decoder.decodeToBytes(text),source:'Sheep-y/Base85'},
  {id:'base85-sheep-z85',family:'Base85',input:'z85',fn:text=>sheep.Z85Decoder.decodeToBytes(text),source:'Sheep-y/Base85'}
];
if(typeof Uint8Array.fromBase64==='function')pool.unshift({id:'base64-fromBase64',family:'Base64',input:'base64',fn:text=>Uint8Array.fromBase64(text),source:'native Uint8Array.fromBase64'});
if(typeof Uint8Array.prototype.setFromBase64==='function')pool.unshift({id:'base64-setFromBase64',family:'Base64',input:'base64',fn:text=>{
  // Canonical no-whitespace input; allocate afresh so buffer reuse cannot bias
  // the comparison against every other returning/allocating decoder.
  const n=text.length,size=n*3/4-(text.charCodeAt(n-1)===61?1:0)-(text.charCodeAt(n-2)===61?1:0),out=new Uint8Array(size);
  out.setFromBase64(text);return out;
},source:'native setFromBase64 with fresh allocation'});

const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const raw=text=>Uint8Array.from(atob(text),x=>x.charCodeAt(0));
function equal(a,b){if(!(a instanceof Uint8Array)||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
let enabled=pool.slice(),chosen={},screenScores=new Map();
export function info(){return {fromBase64:typeof Uint8Array.fromBase64==='function',setFromBase64:typeof Uint8Array.prototype.setFromBase64==='function',candidates:pool.map(({fn,...x})=>x)};}
export function validate(vectors){
  const results=[];
  for(const c of pool){
    let count=0,error='';for(const row of vectors){try{const input=c.input==='base64'?row.raw:row[c.input];if(!equal(c.fn(input),raw(row.raw)))throw Error('Byte mismatch at length '+raw(row.raw).length);count++;}catch(e){error=e.message;break;}}
    results.push({id:c.id,family:c.family,input:c.input,source:c.source,correct:!error,checks:count,error});
  }
  enabled=enabled.filter(c=>results.find(r=>r.id===c.id).correct);
  // Independently check native Rust encoder output against the published JS.
  for(const row of vectors)if(fork.encode(raw(row.raw))!==row.base122)throw Error('Rust encoder disagrees with Base122 reference');
  return {results,referenceEncoderChecks:vectors.length};
}
async function textsFor(sample,kinds,modes){
  const texts={};for(const mode of modes){texts[mode]={};await Promise.all(kinds.map(async kind=>{
    const bytes=await(await fetch('/'+sample.texts[mode][kind])).arrayBuffer();
    texts[mode][kind]=new TextDecoder(kind==='bmp'?'utf-16le':'utf-8').decode(bytes);
  }));}return texts;
}
function timed(entries,texts,batch,run,rounds=9){
  const measurements=[];let sink=0;
  for(let round=-3;round<rounds;round++)for(let step=0;step<entries.length;step++){
    const position=(step+round+run+entries.length)%entries.length,e=entries[position],text=texts[e.tier][e.input],t=performance.now();
    for(let n=0;n<batch;n++){const b=e.fn(text);sink^=b[(step*997)%b.length]||0;}
    const elapsed=performance.now()-t;
    measurements.push({id:e.id,family:e.family,implementation:e.implementation||e.id,source:e.source,tier:e.tier,verifyFormat:e.verifyFormat??null,memoryHeavy:e.memoryHeavy??null,input:e.input,phase:round<0?'warmup':'measured',round,order:step,batch,totalMs:elapsed,decodeMs:elapsed/batch});
  }
  window.encodingComparisonSink=sink;return measurements;
}
export async function screen(sample,run){
  const kinds=[...new Set(enabled.map(c=>c.input))],texts=await textsFor(sample,kinds,['none']),entries=enabled.map(c=>({...c,tier:'none'}));
  for(const e of entries){const b=e.fn(texts.none[e.input]);if(hex(await crypto.subtle.digest('SHA-256',b))!==sample.sha256)throw Error('Screen SHA mismatch '+e.id);}
  const measurements=timed(entries,texts,1,run,7);
  for(const e of entries){const samples=measurements.filter(x=>x.id===e.id&&x.phase==='measured').map(x=>x.decodeMs).sort((a,b)=>a-b),median=samples[3];if(!screenScores.has(e.id))screenScores.set(e.id,[]);screenScores.get(e.id).push(median);}
  return {measurements};
}
export function selectWinners(){
  chosen={};for(const family of ['Base64','Base122','Base121','Base85']){
    const candidates=enabled.filter(c=>c.family===family).map(c=>({c,score:Math.exp(screenScores.get(c.id).reduce((s,n)=>s+Math.log(n),0)/screenScores.get(c.id).length)})).sort((a,b)=>a.score-b.score);
    if(!candidates.length)throw Error('No valid candidate for '+family);chosen[family]=candidates[0].c;
  }
  return Object.fromEntries(Object.entries(chosen).map(([family,{fn,...c}])=>[family,c]));
}
export function useWinners(ids){chosen=Object.fromEntries(Object.entries(ids).map(([family,id])=>[family,enabled.find(c=>c.id===id)]));}
export async function compare(sample,run){
  const entries=[];
  for(const tier of ['none','fast','secure']){
    for(const memoryHeavy of [false,true])for(const verifyFormat of [false,true]){
      const options={verifyData:tier,verifyFormat,memoryHeavy};entries.push({id:'bmp-'+tier+'-'+(+verifyFormat)+'-'+(+memoryHeavy),family:'GlyphPack-Wasm',implementation:'full.min.mjs',source:'local Rust/Wasm codec',tier,verifyFormat,memoryHeavy,input:'bmp',fn:text=>binary(text,options)});
    }
    for(const [family,c]of Object.entries(chosen))entries.push({id:family+'-'+tier,family,implementation:c.id,source:c.source,tier,input:c.input,fn:tier==='none'?c.fn:text=>verify(c.fn(text),tier==='fast'?1:2)});
    // Keep the compatibility-native baseline visible when a newer intrinsic won.
    if(chosen.Base64.id!=='base64-atob')entries.push({id:'atob-'+tier,family:'Base64-atob',implementation:'base64-atob',source:'native atob plus byte conversion',tier,input:'base64',fn:tier==='none'?local.nativeAtob:text=>verify(local.nativeAtob(text),tier==='fast'?1:2)});
  }
  const kinds=[...new Set(entries.map(e=>e.input))],texts=await textsFor(sample,kinds,['none','fast','secure']);
  const first=[];
  for(const e of entries){const t=performance.now(),b=e.fn(texts[e.tier][e.input]),elapsed=performance.now()-t;
    if(!(b instanceof Uint8Array)||b.length!==sample.bytes||hex(await crypto.subtle.digest('SHA-256',b))!==sample.sha256)throw Error('Comparison SHA mismatch '+e.id);
    first.push({id:e.id,family:e.family,implementation:e.implementation,source:e.source,tier:e.tier,verifyFormat:e.verifyFormat??null,memoryHeavy:e.memoryHeavy??null,input:e.input,phase:'first_for_variant',round:0,order:first.length,batch:1,totalMs:elapsed,decodeMs:elapsed});
  }
  const batch=sample.bytes<4096?4096:sample.bytes<100000?32:1;
  return {measurements:first.concat(timed(entries,texts,batch,run)),variants:entries.length};
}
export function checkVerification(){
  // Check actual verifier execution independently of transport decoding.
  let rejected=0;for(const mode of [1,2]){let caught=false;try{verify(new Uint8Array(mode===1?8:36),mode);}catch(e){if(!/mismatch/.test(e.message))throw e;caught=true;}if(!caught)throw Error('Verifier bypass');rejected++;}
  return {checksumAndDigestCorruptionRejected:rejected};
}
