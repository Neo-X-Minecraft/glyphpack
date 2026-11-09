/* Optional data verification. PAYLOAD_DATA_KIND is a build-time constant:
 * 1 = XXH32, 2 = BLAKE3-256. With kind 0, no exports are referenced and the
 * complete module, both hash imports and every integrity error are omitted.
 * Fixed and selected runtime tiers are exact requirements, never negotiated
 * from input metadata. Unselected hash imports/branches are eliminated entirely.
 */
import {xxhash32} from './xxhash32.js';
import {createBlake3} from './blake3.js';
import {invalidLength} from './allocation.js';
// Compatibility alias: declared-length safety is now mandatory in every build.
export {checkAllocationLength as checkIntegrityLength} from './allocation.js';

// Independent defense at the verifier boundary: require an integer data end and
// exactly one complete trailer finishing this packet view (no missing/extra
// bytes). Never rely on header checks, DataView's offset coercion, or undefined
// digest bytes becoming zero in XORs. This checks the buffer contract, not
// whether encoded input supplied every byte; unpacking's coverage check does that.
function checkDigestBounds(bytes,end,digestLength){
  if(!Number.isSafeInteger(end)||end<0||end+digestLength!==bytes.length)invalidLength();
}

// Scratch is initialized only when secure verification actually runs. Fast
// builds remove this binding and the complete BLAKE3 module at build time.
let secureHash;
export function checkIntegrityMode(kind,length){
  const requiredLength=PAYLOAD_DATA_KIND===1?4:32;
  if(kind!==PAYLOAD_DATA_KIND||length<requiredLength)throw Error('Required payload integrity mode missing');
}

// Hash the original, restored bytes, excluding the stored trailer at end.
// Unkeyed digests provide integrity, not proof of origin if data AND digest can
// both be replaced. No keyed/KDF/XOF functionality is included in these builds.
// This verifies decoded bytes, not the Unicode spelling/header/mask used to
// represent them; enable format checking separately for untrusted encoded text.
export function verifyData(bytes,end){
  checkDigestBounds(bytes,end,PAYLOAD_DATA_KIND===1?4:32);
  if(PAYLOAD_DATA_KIND===1){
    const stored=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(end,true);
    if(xxhash32(bytes,end)!==stored)throw Error('Payload checksum mismatch');
  }else{
    const digest=(secureHash||(secureHash=createBlake3()))(bytes,end);
    // Visit every byte; JavaScript does not guarantee constant-time execution.
    let difference=0;for(let i=0;i<32;i++)difference|=digest[i]^bytes[end+i];
    if(difference)throw Error('Payload digest mismatch');
  }
}

// These exports are used only when BOTH verified modes are selected. Builds with
// none + one hash reuse the fixed verifier above, guarded by their selected mode.
// That avoids carrying a hash dispatcher when there is only one hash to call.
export function checkSelectedIntegrityMode(kind,length,selected){
  const requiredLength=selected===1?4:32;
  if(kind!==selected||length<requiredLength)throw Error('Required payload integrity mode missing');
}
export function verifySelectedData(bytes,end,selected){
  checkDigestBounds(bytes,end,selected===1?4:32);
  // The caller excludes none before reaching here. Feature constants also let
  // tree shaking remove a hash branch if a future entry imports this selectively.
  if(PAYLOAD_ALLOW_FAST&&(!PAYLOAD_ALLOW_SECURE||selected===1)){
    const stored=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(end,true);
    if(xxhash32(bytes,end)!==stored)throw Error('Payload checksum mismatch');
  }else if(PAYLOAD_ALLOW_SECURE){
    const digest=(secureHash||(secureHash=createBlake3()))(bytes,end);
    let difference=0;for(let i=0;i<32;i++)difference|=digest[i]^bytes[end+i];
    if(difference)throw Error('Payload digest mismatch');
  }
}
