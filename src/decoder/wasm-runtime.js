/* Thin, synchronous ABI adapter. Native memory and tables remain cached inside
 * the instance; returned bytes always own a fresh JS buffer, matching the wire API.
 * Feature constants remove messages for verification absent from the build.
 */
const littleEndian=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
export function runWasm(api,text,verifyFormat,dataKind,memoryHeavy){
  const length=text.length,pointer=api.input_ptr(length);
  if(pointer===0&&length)throw RangeError('Wasm decoder memory allocation failed');
  // memory growth invalidates old views, so obtain the input view AFTER reserve
  // and obtain the output view AFTER decoding. Never retain either arena view.
  if(littleEndian){
    const input=new Uint16Array(api.memory.buffer,pointer,length);
    for(let i=0;i<length;i++)input[i]=text.charCodeAt(i);
  }else{
    const input=new DataView(api.memory.buffer,pointer,length*2);
    for(let i=0;i<length;i++)input.setUint16(i*2,text.charCodeAt(i),true);
  }
  const status=api.decode(+verifyFormat,dataKind,+memoryHeavy);
  if(status){
    if(status===2)throw Error('Invalid payload length');
    if(status===8)throw RangeError('Wasm decoder memory allocation failed');
    if(PAYLOAD_INCLUDE_FORMAT){
      if(status===1)throw Error('Invalid payload character');
      if(status===3)throw Error('Invalid payload header');
      if(status===4)throw Error('Invalid payload padding');
    }
    if(PAYLOAD_CHECK_DATA){
      if(status===5)throw Error('Required payload integrity mode missing');
      if(PAYLOAD_ALLOW_FAST&&status===6)throw Error('Payload checksum mismatch');
      if(PAYLOAD_ALLOW_SECURE&&status===7)throw Error('Payload digest mismatch');
    }
    throw Error('Wasm decoder failure');
  }
  const stored=api.stored_len(),end=api.payload_len(),bytes=new Uint8Array(stored);
  bytes.set(new Uint8Array(api.memory.buffer,api.output_ptr(),stored));
  return end===stored?bytes:bytes.subarray(0,end);
}
