/* Runtime selectors are imported only for axes with MULTIPLE selected values.
 * Allowed/default values are build constants. No unselected data mode gets a
 * comparison or handler, and invalid choices never silently weaken verification.
 * Single-choice axes are fixed in the generated adapter and do not import these functions.
 */
export function selectFormat(value=PAYLOAD_VERIFY_FORMAT){
  // A varying format axis necessarily includes both booleans.
  if(value!==true&&value!==false)throw Error('Unsupported format verification option');
  return value;
}
export function selectData(value=PAYLOAD_DEFAULT_DATA){
  // Strongest selected mode is the default, independent of selection order.
  // Boolean aliases preserve the encoder's true=secure, false=none convention.
  if(PAYLOAD_ALLOW_SECURE&&(value==='secure'||value===true))return 2;
  if(PAYLOAD_ALLOW_FAST&&value==='fast')return 1;
  if(PAYLOAD_ALLOW_NONE&&(value==='none'||value===false))return 0;
  throw Error('Unsupported data verification mode');
}
