/* Prototype: load SIMD once, with the original JS hash as compatibility backup.
 * The output bytes are owned by JS; only the verifier copies into Wasm. */
async function loadHash(payload) {
  if (typeof WebAssembly === 'undefined' || typeof DecompressionStream === 'undefined') return;
  const compressed = Uint8Array.fromBase64 ? Uint8Array.fromBase64(payload) : Uint8Array.from(atob(payload), c => c.charCodeAt(0));
  const bytes = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  try { return (await WebAssembly.instantiate(bytes)).instance.exports; }
  catch(error) { if (!(error instanceof WebAssembly.CompileError) && !(error instanceof WebAssembly.LinkError)) throw error; }
}
const simdApi = await loadHash(wasmPayload);
let capacity=0, inputView, digestView;
function wasmHash(bytes,end) {
  if (!inputView || bytes.length>capacity) {
    const pointer=simdApi.reserve(bytes.length);
    if(!pointer)throw RangeError('Wasm decoder memory allocation failed');
    capacity=bytes.length;
    inputView=new Uint8Array(simdApi.memory.buffer,pointer,capacity);
    digestView=undefined;
  }
  // Copy the tiny trailer too to avoid creating a subarray for the payload.
  // The hash length explicitly excludes it. No payload-sized output copy follows.
  inputView.set(bytes);
  const pointer=simdApi.blake3(end);
  if(!digestView)digestView=new Uint8Array(simdApi.memory.buffer,pointer,32);
  return digestView;
}
