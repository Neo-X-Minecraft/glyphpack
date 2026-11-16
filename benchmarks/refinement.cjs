/* 0BSD, NeoX. Paired complete binary() calls over the current wire format.
 * Each source owns its Wasm instance. Imports, encoding, warm-up and SHA-256
 * checks are excluded; allocation, selected checks, staging and copying count. */
const fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), http = require('node:http'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const dir = path.resolve(root, process.env.REFINE_OUTPUT || 'benchmarks/results/refinement');
const vectors = require('../generated/integration/vectors.json');
const files = process.argv.slice(2);
if (files.length !== 2) throw Error('Usage: node benchmarks/refinement.cjs before.mjs after.mjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sources = files.map((file, index) => {
  const bytes = fs.readFileSync(file);
  return { name: index ? 'after' : 'before', file: path.relative(root, file), bytes: bytes.length,
    sha256: sha(bytes), url: 'data:text/javascript;base64,' + bytes.toString('base64') };
});
const input = fs.readFileSync(vectors.input), cases = [];
function encode(bytes, packing, mode) {
  return execFileSync(path.join(root, 'target/release/glyphpack'),
    ['encode', '-', '--packing', packing, '--checksum', mode, '--mask', '0', '--text'],
    { input: bytes, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
// All twelve policies for each codec, plus empty, small and medium defaults.
for (const packing of ['pair', 'ans', 'windows', 'utf8', 'utf8-compact']) {
  for (const mode of ['none', 'fast', 'secure']) {
    const text = mode === 'fast' ? encode(input, packing, mode)
      : fs.readFileSync(vectors.large.find(r => r.packing === packing && r.mode === mode).file, 'utf8');
    for (const verifyFormat of [false, true]) for (const memoryHeavy of [false, true])
      cases.push({ name: [packing, mode, +verifyFormat, +memoryHeavy].join(':'), packing,
        mode, verifyFormat, memoryHeavy, text, bytes: input.length, expected: sha(input) });
  }
}
for (const size of [0, 1024, 65536]) for (const packing of ['pair', 'utf8', 'utf8-compact']) {
  const bytes = input.subarray(0, size);
  cases.push({ name: packing + '-small-' + size, packing, mode: 'secure', verifyFormat: true,
    memoryHeavy: false, text: encode(bytes, packing, 'secure'), bytes: size, expected: sha(bytes) });
}
// Share each resident packet across its four policy combinations. Duplicating
// large strings in CDP arguments can exhaust the renderer before timing starts.
const packets = [...new Set(cases.map(job => job.text))];
const jobs = cases.map(({ text, ...job }) => ({ ...job, packet: packets.indexOf(text) }));
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const server = http.createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.end('<!doctype html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const records = [], runs = 3, rounds = 7;
  try {
    for (let run = 0; run < runs; run++) {
      const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || '/usr/bin/chromium',
        headless: true, args: ['--no-sandbox'] });
      try {
        if (browser.version() !== require('./chromium.json').version) throw Error('Wrong Chromium version');
        for (const size of [...new Set(jobs.map(job => job.bytes))].filter(size => !process.env.REFINE_SIZES || process.env.REFINE_SIZES.split(",").map(Number).includes(size))) {
        const isolated = await browser.newContext();
        try {
        const probe = await isolated.newPage();
        await probe.goto("http://127.0.0.1:" + server.address().port);
        const measured = await probe.evaluate(async ({ sources, jobs, packets, run, rounds }) => {
          const modules = await Promise.all(sources.map(s => import(s.url)));
          modules.forEach(m => m.warmup(['pair', 'ans', 'windows', 'utf8', 'utf8-compact']));
          // Warm and measure each source in alternating order to avoid call-site tiering bias.
          const rows = jobs.flatMap(c => modules.map((_, variant) => ({ ...c, variant, samples: [] })));
          let sink = 0;
          const call = job => {
            let out;
            try { out = modules[job.variant].binary(packets[job.packet], { verifyData: job.mode,
              verifyFormat: job.verifyFormat, memoryHeavy: job.memoryHeavy }); }
            catch (error) { throw Error(sources[job.variant].name + ':' + job.name + ': ' + error.message); }
            sink ^= out[0] || 0;
            return out;
          };
          for (const job of rows) {
            const out = call(job), digest = Array.from(new Uint8Array(
              await crypto.subtle.digest('SHA-256', out)), b => b.toString(16).padStart(2, '0')).join('');
            if (out.length !== job.bytes || digest !== job.expected) throw Error('Output mismatch: ' + job.name);
            for (let i = 0; i < (job.bytes <= 1024 ? 1024 : 6); i++) call(job);
          }
          for (let round = 0; round < rounds; round++) for (let i = 0; i < rows.length; i++) {
            const job = rows[(i + round * 7 + run * 3) % rows.length];
            const batch = job.bytes <= 1024 ? 128 : 2, start = performance.now();
            for (let j = 0; j < batch; j++) call(job);
            job.samples.push((performance.now() - start) / batch);
          }
          globalThis.refinementSink = sink;
          return rows.map(({ text, expected, ...job }) => ({ ...job,
            median: [...job.samples].sort((a, b) => a - b)[rounds >> 1] }));
        }, { sources, jobs: jobs.filter(job => job.bytes === size), packets, run, rounds });
        records.push(...measured.map(row => ({ ...row, run })));
        console.log(JSON.stringify({ run: run + 1, size, cases: measured.length }));
        } finally { await isolated.close(); }
        }
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  const summary = cases.filter(job => records.some(r => r.name === job.name)).map(job => ({ case: job.name, ...Object.fromEntries(sources.map((s, variant) =>
    [s.name, median(records.filter(r => r.name === job.name && r.variant === variant).map(r => r.median))])) }));
  fs.writeFileSync(path.join(dir, 'decode.json'), JSON.stringify({ recordedAt: new Date().toISOString(),
    sources: sources.map(({ url, ...s }) => s), inputSha256: sha(input),
    browser: require('./chromium.json').version, architecture: process.arch,
    cpu: os.cpus()[0]?.model, kernel: os.release(), runs, rounds,
    scope: 'Resident string to owned bytes; all requested checks, staging and copying included. Encoding, imports, warm-up and SHA-256 excluded. Alternating sources; separate contexts per input size; independent browser processes. Small calls warm up 1024 times, large calls six times.',
    records, summary }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'summary.csv'), 'case,before_ms,after_ms,change_percent\n' + summary.map(r =>
    [r.case, r.before.toFixed(6), r.after.toFixed(6), ((r.after / r.before - 1) * 100).toFixed(2)].join(',')).join('\n') + '\n');
  console.log(JSON.stringify(summary.filter(r => r.case.endsWith('secure:1:0'))));
})().catch(error => { console.error(error); process.exitCode = 1; });
