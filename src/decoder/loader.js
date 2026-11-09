/* One-time module initialization. The containing ESM awaits this function, so
 * callers receive a ready, synchronous binary() after import resolves. Temporary
 * compressed/decompressed arrays have no global roots after instantiation.
 */
export async function loadWasm(payload){
  if(typeof WebAssembly==='undefined')throw Error('WebAssembly is required');
  if(typeof DecompressionStream==='undefined')throw Error('DecompressionStream is required');
  let compressed;
  if(Uint8Array.fromBase64)compressed=Uint8Array.fromBase64(payload);
  else{
    const text=atob(payload);compressed=new Uint8Array(text.length);
    for(let i=0;i<text.length;i++)compressed[i]=text.charCodeAt(i);
  }
  const bytes=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return(await WebAssembly.instantiate(bytes)).instance.exports;
}
