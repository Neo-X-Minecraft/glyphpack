/* Test-only bridge to the Rust compiler. Decoder execution stays in JS. */
const {execFileSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..'),cache=new Map();
const executable=process.env.GLYPHPACK_BIN||path.join(root,'target/release/glyphpack');
function decoderSource({verifyFormat=true,verifyData='secure',legacy=false}={}){
 const args=['build','--data',...(Array.isArray(verifyData)?verifyData:[verifyData])];
 if(Array.isArray(verifyFormat))args.push('--format',...verifyFormat.map(x=>x?'on':'off'));
 else if(!verifyFormat)args.push('--no-format-checks');
 if(legacy)args.push('--legacy');
 const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,execFileSync(executable,args,{encoding:'utf8'}));return cache.get(key);
}
async function decoder(options){const module=await import('data:text/javascript;base64,'+Buffer.from(decoderSource(options)).toString('base64'));return module.binary;}
module.exports={decoderSource,decoder};
