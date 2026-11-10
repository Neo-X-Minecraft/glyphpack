/* Paired complete decoder calls. The native `bench prepare` command owns input
 * construction; this browser-only harness compares two self-contained modules. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),[before,after,output='generated/results/paired.json']=process.argv.slice(2);
const median=v=>{v=v.slice().sort((a,b)=>a-b);return(v[(v.length-1)>>1]+v[v.length>>1])/2;};
async function main(){
 if(!before||!after)throw Error('Usage: node benchmarks/compare.cjs before.mjs after.mjs [output.json]');
 const modules=[before,after].map(file=>{const bytes=fs.readFileSync(file);return{path:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),url:'data:text/javascript;charset=utf-8;base64,'+bytes.toString('base64')};});
 const inputs=JSON.parse(fs.readFileSync(path.join(root,'generated/encoding-comparison/inputs.json'))).filter(s=>['random-1KiB','random-64KiB','random-1MiB','zeros-1MiB','sequential-1MiB'].includes(s.label));
 const rows=[];let browserVersion;
 for(let run=0;run<3;run++){
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN||'/usr/bin/chromium',args:['--no-sandbox']});
  try{
   browserVersion=browser.version();assert.equal(browserVersion,process.env.CHROMIUM_VERSION||require('./chromium.json').version);
   const page=await browser.newPage();await page.evaluate(async urls=>{window.decoders=await Promise.all(urls.map(async url=>(await import(url)).binary));},modules.map(m=>m.url));
   for(const input of inputs){
    const packets=Object.fromEntries(['none','fast','secure'].map(mode=>[mode,fs.readFileSync(path.join(root,input.texts[mode].bmp)).toString('utf16le')]));
    const result=await page.evaluate(({packets,bytes,run})=>{
     const rows=[],batch=bytes<4096?128:bytes<100000?8:1;
     for(const verifyData of ['none','fast','secure'])for(const verifyFormat of [false,true])for(const memoryHeavy of [false,true]){
      const options={verifyData,verifyFormat,memoryHeavy},text=packets[verifyData];
      const a=decoders[0](text,options),b=decoders[1](text,options);if(a.length!==b.length||a.buffer.byteLength!==b.buffer.byteLength||a.byteOffset!==b.byteOffset)throw Error('Output shape mismatch');for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error('Byte mismatch');
      const samples=[[],[]];let sink=0;for(let round=-3;round<9;round++)for(let j=0;j<2;j++){
       const k=(round+j+run+4)%2,start=performance.now();for(let n=0;n<batch;n++){const out=decoders[k](text,options);sink^=out[(n*997)%out.length]||0;}const elapsed=(performance.now()-start)/batch;if(round>=0)samples[k].push(elapsed);
      }
      rows.push({...options,batch,samples,sink});
     }return rows;
    },{packets,bytes:input.bytes,run});
    rows.push(...result.map(r=>({...r,run:run+1,dataset:input.label,bytes:input.bytes})));console.log(JSON.stringify({run:run+1,dataset:input.label,variants:result.length}));
   }
  }finally{await browser.close();}
 }
 const groups=new Map();for(const r of rows){const key=JSON.stringify([r.dataset,r.verifyData,r.verifyFormat,r.memoryHeavy]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const summary=[...groups.values()].map(group=>{const before=median(group.map(r=>median(r.samples[0]))),after=median(group.map(r=>median(r.samples[1]))),r=group[0];return{dataset:r.dataset,bytes:r.bytes,integrity:r.verifyData,format:r.verifyFormat,memory:r.memoryHeavy,before_ms:before,after_ms:after,speedup:before/after};});
 const report={schema:1,browser:browserVersion,architecture:os.arch(),cpuModels:[...new Set(os.cpus().map(c=>c.model))],date:new Date().toISOString(),modules:modules.map(({url,...m})=>m),methodology:{runs:3,warmups:3,measured:9,order:'alternate implementations each round',timed:'complete binary() with fresh output and selected verification',excluded:'fixture construction, imports, byte comparison',limits:'single unpinned host; warmed instances and lookup tables; medians are not tail latencies'},summary,rows};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 const fields=Object.keys(summary[0]);fs.writeFileSync(output.replace(/\.json$/,'')+'.csv',fields.join(',')+'\n'+summary.map(r=>fields.map(k=>r[k]).join(',')).join('\n')+'\n');
 console.log(JSON.stringify({pass:true,browser:browserVersion,cases:rows.length,output}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
