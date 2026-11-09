/* Chromium/JS decoder orchestration. Native preparation, serving and compact
 * CSV generation live in Rust; all measured operations execute inside V8. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const root=path.resolve(__dirname,'..'),origin=process.argv[2],smoke=process.argv[3]==='smoke';
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const inputs=read('generated/encoding-comparison/inputs.json'),vectors=read('generated/encoding-comparison/vectors.json');
for(const input of inputs)input.sha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,input.binary))).digest('hex');
const config=read('benchmarks/chromium.json'),version=process.env.CHROMIUM_VERSION||config.version;
const executable=process.env.CHROMIUM_BIN||['/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p));
const out=path.join(root,'generated/results');fs.mkdirSync(out,{recursive:true});
const fields=['record_type','stage','timestamp_utc','browser','v8','architecture','run','dataset','decoded_bytes','family','implementation','variant_id','integrity_mode','verification_algorithm','verify_format','memory_heavy','input_format','phase','sample_index','execution_order','iterations','total_decode_ms','decode_ms','throughput_MB_per_s','statistic','correct','validation_cases','error','source','notes','expected_decoded_sha256','codec_sha256','competitors_sha256','verifier_sha256','browser_executable','logical_cpu_count'];
const hashes=Object.fromEntries([['codec_sha256','dist/full.min.mjs'],['competitors_sha256','generated/encoding-comparison/competitors.mjs'],['verifier_sha256','generated/encoding-comparison/checks.mjs']].map(([k,p])=>[k,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
const csv=value=>{const s=value==null?'':String(value);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
const rows=[],median=a=>{a=a.slice().sort((a,b)=>a-b);return(a[(a.length-1)>>1]+a[a.length>>1])/2;};
const report={pass:false,mode:smoke?'smoke':'comparison',targetVersion:version,architecture:os.arch(),runs:[],methodology:{timed:'resident JS string -> freshly allocated bytes, including selected verification',excluded:'encoding, I/O, module/text parsing, SHA-256 correctness checks',statistics:'3 fresh browser processes; 3 warm-up rounds excluded; 9 measured batches; rotated order',cache:'one shared full-module instance per browser; heavy table lazy and then warm',selection:'fastest correct tested candidate by geometric mean of two screening datasets; no global fastest claim',base121:'local Base122 extension excluding <; not a published standard',format:'all timed inputs valid; peer structural checks differ',backend:'Rust/Wasm; gzip decompression, base64 decoding and Wasm compilation/instantiation finish before timers; peer verifiers use the historical JS reference',fixtures:'deterministic synthetic data plus caller-supplied binaries; historical asset inputs are not bundled'},hashes};
const record=(context,stage,sample,result)=>{
 for(const m of result.measurements)rows.push({...context,...hashes,record_type:'sample',stage,timestamp_utc:new Date().toISOString(),dataset:sample.label,decoded_bytes:sample.bytes,family:m.family,implementation:m.implementation,variant_id:m.id,integrity_mode:m.tier,verification_algorithm:{none:'none',fast:'XXH32',secure:'BLAKE3-256'}[m.tier],verify_format:m.verifyFormat,memory_heavy:m.memoryHeavy,input_format:m.input,phase:m.phase,sample_index:m.round,execution_order:m.order,iterations:m.batch,total_decode_ms:m.totalMs,decode_ms:m.decodeMs,throughput_MB_per_s:sample.bytes/1000/m.decodeMs,correct:true,source:m.source,expected_decoded_sha256:sample.sha256,notes:'Output SHA-256 checked outside timer; decimal MB/s'});
};
(async()=>{
 let selected;
 for(let run=0;run<(smoke?1:3);run++){
  const browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
   assert.equal(browser.version(),version,'Unexpected Chromium version; choose CHROMIUM_BIN/CHROMIUM_VERSION explicitly');
   const page=await browser.newPage();await page.goto(origin+'/benchmarks/blank.html');
   const engine=await(await page.context().newCDPSession(page)).send('Browser.getVersion');
   const context={browser:browser.version(),v8:engine.jsVersion,architecture:os.arch(),run:run+1,browser_executable:executable||'Playwright bundled',logical_cpu_count:os.cpus().length};
   await page.evaluate(async()=>{window.encodingBench=await import('/benchmarks/fixtures/encoding-compare-runner.js');});
   const validation=await page.evaluate(v=>encodingBench.validate(v),vectors);
   assert(validation.results.every(r=>r.correct),JSON.stringify(validation));
   report.validation=validation;report.verification=await page.evaluate(()=>encodingBench.checkVerification());report.nativeSupport=await page.evaluate(()=>encodingBench.info());
   if(!run){
    for(const sample of [inputs.find(s=>s.label==='random-1MiB'),inputs.find(s=>s.label==='runtime')])record(context,'candidate-screen',sample,await page.evaluate(s=>encodingBench.screen(s,0),sample));
    selected=await page.evaluate(()=>encodingBench.selectWinners());report.selectedImplementations=selected;
   }else await page.evaluate(ids=>encodingBench.useWinners(ids),Object.fromEntries(Object.entries(selected).map(([family,c])=>[family,c.id])));
   const samples=smoke?[inputs.find(s=>s.label==='random-64KiB')]:inputs;
   for(const sample of samples){
    const result=await page.evaluate(({sample,run})=>encodingBench.compare(sample,run),{sample,run});record(context,'comparison',sample,result);
    // Chrome 109 has no newer Base64 intrinsic; avoid counting its atob winner
    // twice. Newer browsers additionally retain the separate atob baseline.
    assert.equal(result.variants,selected.Base64.id==='base64-atob'?24:27);
    assert.equal(result.measurements.filter(m=>m.family==='GlyphPack-Wasm'&&m.phase==='first_for_variant').length,12);
    report.runs.push({run:run+1,dataset:sample.label,bytes:sample.bytes,variants:result.variants});
    console.log(JSON.stringify(report.runs.at(-1)));
   }
   // A real UTF-16LE document verifies the BOM/parser boundary as well as the
   // JS transport. No screenshot or external image assets are involved.
   const demo=path.join(root,'generated/demo.html');execFileSync(process.env.GLYPHPACK_BIN,['demo',demo]);
   const doc=await browser.newPage();await doc.context().setOffline(true);await doc.goto(require('node:url').pathToFileURL(demo).href);await doc.waitForFunction(()=>document.querySelector('output')?.textContent==='Hello from GlyphPack. ✓');report.utf16HtmlRoundTrip=true;
   if(smoke){
    const fixture=read('generated/test-vectors.json');
    report.profileMatrix=await page.evaluate(async v=>{
     let roundTrips=0;
     for(const p of v.profiles){const {binary}=await import('data:text/javascript;base64,'+btoa(p.source));for(const row of v.rows.slice(0,6))for(const verifyFormat of p.formats)for(const verifyData of p.modes)for(const memoryHeavy of p.memories){const b=binary(row.packets[verifyData],{verifyFormat,verifyData,memoryHeavy});if(Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')!==row.rawHex)throw Error('Profile matrix mismatch');roundTrips++;}}
     for(const file of ['full.mjs','full.min.mjs']){const {binary}=await import('/dist/'+file);for(const verifyFormat of [false,true])for(const verifyData of ['none','fast','secure'])for(const memoryHeavy of [false,true]){const row=v.rows.at(-1),b=binary(row.packets[verifyData],{verifyFormat,verifyData,memoryHeavy});if(Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')!==row.rawHex)throw Error('ESM mismatch');roundTrips++;}}
     return{profiles:v.profiles.length,roundTrips,esmCombinations:24};
    },fixture);

   }
  }finally{await browser.close();}
 }
 // Summaries remain explicitly tagged, so they cannot be mixed into raw
 // observations accidentally. This retains every warm-up/first/measured batch.
 const groups=new Map();for(const r of rows.filter(r=>r.phase==='measured')){const key=JSON.stringify([r.stage,r.dataset,r.variant_id,r.run]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 for(const group of groups.values()){const r=group[0],m=median(group.map(r=>r.decode_ms));rows.push({...r,record_type:'summary',sample_index:'',execution_order:'',decode_ms:m,statistic:'run_median',iterations:group.reduce((s,r)=>s+r.iterations,0),total_decode_ms:group.reduce((s,r)=>s+r.total_decode_ms,0),throughput_MB_per_s:r.decoded_bytes/1000/m});}
 report.pass=true;report.csvRows=rows.length;
 const name=smoke?'smoke':'encoding-decode-benchmark';fs.writeFileSync(path.join(out,name+'.csv'),fields.join(',')+'\n'+rows.map(r=>fields.map(k=>csv(r[k])).join(',')).join('\n')+'\n');fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({pass:true,browser:version,rows:rows.length,report:'generated/results/'+name+'.json',profileMatrix:report.profileMatrix}));
})().catch(e=>{console.error(e);process.exitCode=1;});
