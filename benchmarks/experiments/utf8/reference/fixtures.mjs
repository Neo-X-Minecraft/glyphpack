import { createHash } from 'node:crypto';

// SHA-256 counter-mode pseudorandom fixtures: reproducible, not a security API.
export function randomFixture(n, seed = 'utf8-packing-test-v1') {
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i += 32) {
    const digest = createHash('sha256').update(seed + ':' + (i / 32)).digest();
    digest.copy(out, i, 0, Math.min(32, n - i));
  }
  return out;
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

