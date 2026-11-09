/* Shared, once-per-bundle alphabet lookup. No verification or hashing. */
// This ordered alphabet must exactly match encoder.py. Exclude '<'
// for HTML raw-text embedding, controls, surrogates, noncharacters, BOM, and
// JS line/paragraph separators. Every remaining symbol is one UTF-16 unit.
const table=new Uint16Array(65536);let radix=0;
for(let c=32;c<65534;c++){
  if(c===60||(c>=127&&c<=159)||(c>=55296&&c<=57343)||(c>=64976&&c<=65007)||c===65279||c===8232||c===8233)continue;
  table[c]=++radix;
}
// Zero marks an invalid symbol; indices are stored plus one so alphabet
// index zero remains distinguishable from the typed array's default zero.
// R^2 symbol pairs cover all 31-bit values and some 32-bit values. Values
// whose low 31 bits exceed this boundary consume 31 bits, otherwise 32.
const threshold=radix*radix-2147483649;

export {table,radix,threshold};
