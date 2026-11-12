// 0BSD, NeoX. Supplied appendix test suite; workspace fallbacks removed and output redirected.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { encode, decode, profiles, modelFor, pointFor, digitFor,
  protect, makeHTML } from './codec.mjs';
import { arithmeticEncode, decodeArithmetic, makeArithmeticHTML } from './arithmetic.mjs';
import { randomFixture, sha256 } from './fixtures.mjs';

const dir = new URL('../../../../generated/utf8-reference-tests/', import.meta.url);
await mkdir(dir, { recursive: true });
let roundTrips = 0, codePoints = 0;

for (const profile of Object.keys(profiles)) {
  const m = modelFor(profile, 1);
  for (let w = 1; w <= 4; w++) {
    for (let d = 0; d < m.counts[w - 1]; d++) {
      const cp = pointFor(d, w, m), inverse = digitFor(cp, m);
      if (inverse[0] !== d || inverse[1] !== w) throw Error('Code point inverse');
      assert.ok(cp < 0xd800 || cp >= 0xe000);
      codePoints++;
    }
  }
  for (const n of [0, 1, 2, 3, 7, 31, 32, 33, 255, 256, 257, 4095, 4096, 4097, 8193]) {
    for (const source of [randomFixture(n), Buffer.alloc(n), Buffer.alloc(n, 255),
      Buffer.from(Array.from({ length: n }, (_, i) => i & 255))]) {
      for (const [enc, dec] of [[encode, decode], [arithmeticEncode, decodeArithmetic]]) {
        const encoded = enc(source, { profile });
        assert.deepEqual(Buffer.from(dec(encoded, n, { profile })), source);
        // Simulate the HTML tokenizer's NUL replacement independently of Chromium.
        assert.deepEqual(Buffer.from(dec(encoded.replace(/\0/g, '\ufffd'), n, { profile })), source);
        assert.ok(!encoded.includes('\r'));
        assert.ok(!/<\/script|<!--/i.test(encoded));
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded));
        roundTrips++;
      }
    }
  }
  // Exhaust all possible one-byte inputs, including padding and leading zeroes.
  for (let b = 0; b < 256; b++) {
    for (const [enc, dec] of [[encode, decode], [arithmeticEncode, decodeArithmetic]]) {
      const bytes = Buffer.from([b]);
      assert.deepEqual(Buffer.from(dec(enc(bytes, { profile, blockSize: 1 }), 1,
        { profile, blockSize: 1 })), bytes);
      roundTrips++;
    }
  }
}

const hazards = ['</script>', '</ScRiPt >', '</SCRIPT/>', '</script\t>',
  '</script\n>', '</script\f>', '<!--', '<!--<script>--></script>',
  '<\x01\x01\x01', '<\x01\x01\x01\x01\x01\x01', '${globalThis.injected=1}',
  '`', '\\', '\0', '\u2028', '\u2029', '\u0080', '\ufeff', '\ufffe', '\uffff', '\u{10ffff}'];
for (const s of hazards) assert.equal(protect(s).replace(/<\x01\x01\x01/g, '<'), s);
assert.throws(() => decode(encode(Buffer.from('test')).slice(0, -1), 4));
assert.throws(() => decodeArithmetic(arithmeticEncode(Buffer.from('test')).slice(0, 1), 4));

// Optional dependency discovery. The current workspace already has Playwright;
// no existing repository is modified. Else install Playwright in this folder.
const require = createRequire(import.meta.url);
let playwright, browser, browserError;
for (const candidate of Number(process.versions.node.split('.')[0]) < 20 ? [] :
  [process.env.PLAYWRIGHT_MODULE, 'playwright']) {
  if (!candidate) continue;
  try { playwright = require(candidate); break; } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }
}
if (playwright) {
  try {
    browser = await playwright.chromium.launch({
      executablePath: process.env.CHROMIUM_BIN || '/usr/bin/chromium',
      args: ['--no-sandbox'], headless: true,
    });
  } catch (e) {
    browserError = e.message.includes('Operation not permitted') ?
      'Chromium launch blocked by sandbox socket operations (Operation not permitted).' : e.message;
  }
} else browserError = 'Playwright unavailable for this Node version; Playwright 1.63 requires Node >=20.';
let parse5, parserVersion;
if (!browser) {
  for (const candidate of [process.env.PARSE5_MODULE, 'parse5']) {
    if (!candidate) continue;
    try { parse5 = require(candidate); parserVersion = require(candidate + '/package.json').version; break; }
    catch (e) { if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw e; }
  }
  if (!parse5) throw Error('HTML verification needs npm install --no-save parse5, or PARSE5_MODULE');
}
const browserResults = [];
try {
  const page = browser ? await browser.newPage() : null;
  const errors = [];
  if (page) page.on('pageerror', e => errors.push(e.message));
  async function checkPage(filename, html, expected, variable = 'unpacked') {
    const url = new URL(filename, dir);
    await writeFile(url, html);
    const source = await readFile(url);
    new TextDecoder('utf-8', { fatal: true }).decode(source);
    const t = performance.now();
    let actual;
    if (page) {
      await page.goto(url.href, { waitUntil: 'load' });
      assert.deepEqual(errors, [], filename + ': JavaScript errors');
      actual = await page.evaluate(async variable => {
      const value = globalThis[variable];
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      if (!bytes) throw Error('Missing decoded result');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return { n: bytes.length, hash: Array.from(new Uint8Array(digest),
        b => b.toString(16).padStart(2, '0')).join(''), charset: document.characterSet,
        injected: globalThis.injected || 0 };
      }, variable);
    } else {
      const tree = parse5.parse(source.toString('utf8')), nodes = [];
      function visit(node) { nodes.push(node); for (const child of node.childNodes || []) visit(child); }
      visit(tree);
      const attr = (node, name) => node.attrs?.find(x => x.name === name)?.value;
      const text = node => (node.childNodes || []).map(x => x.value || '').join('');
      const doc = { characterSet: 'UTF-8', getElementById(id) {
        const node = nodes.find(x => attr(x, 'id') === id);
        return node ? { textContent: text(node) } : null;
      } };
      assert.ok(nodes.some(x => x.tagName === 'meta' && attr(x, 'charset') === 'utf-8'));
      const context = vm.createContext({ document: doc, Uint8Array, TextEncoder });
      for (const node of nodes.filter(x => x.tagName === 'script' && !attr(x, 'type')))
        vm.runInContext(text(node), context, { filename, timeout: 30000 });
      const value = context[variable];
      assert.ok(value !== undefined, 'Missing decoded result');
      const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
      actual = { n: bytes.length, hash: sha256(bytes), charset: doc.characterSet,
        injected: context.injected || 0 };
    }
    assert.equal(actual.charset, 'UTF-8');
    assert.equal(actual.n, expected.length);
    assert.equal(actual.hash, sha256(expected), filename);
    assert.equal(actual.injected, 0);
    browserResults.push({ file: filename, bytes: expected.length,
      sourceBytes: source.length, parseExecuteAndHashMs: +(performance.now() - t).toFixed(2) });
  }
  for (const profile of ['utf8-data', 'utf8-template', 'utf8-clean', 'ascii-data']) {
    const bytes = randomFixture(65536);
    for (const [name, maker] of [['enumerative', makeHTML], ['arithmetic', makeArithmeticHTML]]) {
      await checkPage(profile + '-' + name + '.html', maker(bytes, { profile }).html, bytes);
    }
  }
  // Every Unicode scalar permitted by the profiles goes through the real HTML
  // parser. This includes all supplementary planes and every noncharacter.
  for (const template of [false, true]) {
    const chunks = [];
    let points = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp === 13 || cp === 0xfffd || cp >= 0xd800 && cp < 0xe000 ||
        template && (cp === 92 || cp === 96)) continue;
      points.push(cp);
      if (points.length === 4096) { chunks.push(String.fromCodePoint(...points)); points = []; }
    }
    chunks.push(String.fromCodePoint(...points));
    const raw = hazards.filter(s => !template || s !== '`' && s !== '\\').join('|') + chunks.join('');
    let encoded = protect(raw), html;
    const recover = '.replace(/\\ufffd/g,"\\0").replace(/<\\x01\\x01\\x01/g,"<")';
    if (template) {
      encoded = encoded.replace(/\$\{/g, '\\${');
      html = '<meta charset=utf-8><script>globalThis.probe=`' + encoded + '`' + recover + ';</script>';
    } else {
      html = '<meta charset=utf-8><script type=x id=p>' + encoded +
        '</script><script>globalThis.probe=document.getElementById("p").textContent' + recover + ';</script>';
    }
    await checkPage('all-unicode-' + (template ? 'template' : 'data') + '.html', html, Buffer.from(raw), 'probe');
  }
  const large = randomFixture(1048576);
  await checkPage('random-1MiB-arithmetic.html', makeArithmeticHTML(large).html, large);
  for (const name of ['enumerative-utf8-data', 'arithmetic-utf8-data',
    'arithmetic-utf8-template', 'arithmetic-utf8-clean']) {
    let html;
    try { html = await readFile(new URL('./generated/compact-' + name + '.html', import.meta.url), 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (html) await checkPage('compact-' + name + '.html', html, large);
  }
} finally { if (browser) await browser.close(); }

const result = { node: process.version, roundTrips, codePoints,
  verificationEngine: browser ? 'Chromium' : 'parse5 + Node vm (not a real browser)',
  browserStatus: browser ? 'passed' : 'unavailable', browserError,
  parserVersion, chromium: browser?.version(), browserPages: browser ? browserResults.length : 0,
  htmlPages: browserResults.length, htmlResults: browserResults };
await writeFile(new URL('../../../../generated/utf8-reference-test-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

