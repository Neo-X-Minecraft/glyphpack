/* Optional 256 KiB high-digit lookup. Imported only by memory-heavy builds.
 * Initialization is lazy: including both strategies does not allocate this
 * table until a successfully parsed packet selects the heavy decoder. Cache it
 * afterward so repeated calls amortize the setup cost. Compact calls never
 * create it, but switching back does not discard an already-created cache.
 */
import {table,radix} from './alphabet.js';

let highDigits;
export function getHighDigits(){
  if(!highDigits){
    const high=new Uint32Array(65536);
    // Zero remains the invalid-character sentinel. Valid entries are one-based
    // high contributions, allowing low + high - 2 in a checked pair loop.
    // The maximum is 4,017,594,841, safely below 2**32.
    for(let cp=0;cp<65536;cp++)if(table[cp])high[cp]=radix*(table[cp]-1)+1;
    highDigits=high;
  }
  return highDigits;
}
