/* 0BSD, NeoX. Differential guard checks against the encoder's direct rule.
 * Check arbitrary UTF-16 text too: malformed units must not change guard logic. */
const assert = require('node:assert/strict');
(async () => {
  const { unprotect } = await import('../src/utf8-compact/guards.mjs');
  const protect = text => text.replace(/<(?=\/?script|!--|\x01\x01\x01)/gi, '<\x01\x01\x01');
  const tokens = ['', '<', 'script', '/sCrIpT', '!--', '>', '\x01', '\x01\x01', '\x01\x01\x01', '\x01\x01\x01\x01', '&', 'λ', '\ud800', '\0', '\r'];
  let seed=815, checked=0;
  const check = text => {
    const raw = text.replace(/<\x01\x01\x01/g, '<');
    assert.equal(unprotect(text, false), raw);
    if (protect(raw) === text) assert.equal(unprotect(text, true), raw);
    else assert.throws(() => unprotect(text, true), {message:'Invalid payload padding'});
    assert.equal(unprotect(protect(text), true), text);
    checked++;
  };
  for (const a of tokens) for (const b of tokens) for (const c of tokens) check(a+b+c);
  for(let i=0;i<20000;i++) {
    let text='';
    for(let n=0;n<12;n++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;text+=tokens[seed%tokens.length];}
    check(text);
  }
  console.log(JSON.stringify({passed:true,guardCases:checked,policies:2}));
})().catch(e=>{console.error(e);process.exitCode=1});
