/* Imported only when the build includes BOTH memory strategies. Keep this
 * separate from verification selectors so compact-only builds do not even read
 * this module. A fixed strategy needs no parser or runtime strategy branch.
 */
export function selectMemory(value=PAYLOAD_MEMORY_HEAVY){
  if(value!==true&&value!==false)throw Error('Unsupported memory optimization option');
  return value;
}
