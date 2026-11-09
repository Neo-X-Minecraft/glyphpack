//! Dependency-free, one-shot XXH32 and unkeyed BLAKE3-256 for native encoding.
//! Browser verification has independent optimized implementations in `decoder/`.
//! Digests detect changed bytes; an unkeyed digest does not establish authorship.

/// XXH32 with seed zero, using explicit wrapping arithmetic on every lane.
pub fn xxhash32(data: &[u8]) -> u32 {
    const P1: u32 = 0x9e3779b1;
    const P2: u32 = 0x85ebca77;
    const P3: u32 = 0xc2b2ae3d;
    const P4: u32 = 0x27d4eb2f;
    const P5: u32 = 0x165667b1;
    fn word(b: &[u8]) -> u32 {
        u32::from_le_bytes(b[..4].try_into().unwrap())
    }
    fn lane(a: u32, b: u32) -> u32 {
        a.wrapping_add(b.wrapping_mul(P2))
            .rotate_left(13)
            .wrapping_mul(P1)
    }
    let mut at = 0;
    let mut h = if data.len() >= 16 {
        let (mut a, mut b, mut c, mut d) = (P1.wrapping_add(P2), P2, 0, 0u32.wrapping_sub(P1));
        while at + 16 <= data.len() {
            a = lane(a, word(&data[at..]));
            b = lane(b, word(&data[at + 4..]));
            c = lane(c, word(&data[at + 8..]));
            d = lane(d, word(&data[at + 12..]));
            at += 16;
        }
        a.rotate_left(1)
            .wrapping_add(b.rotate_left(7))
            .wrapping_add(c.rotate_left(12))
            .wrapping_add(d.rotate_left(18))
    } else {
        P5
    };
    h = h.wrapping_add(data.len() as u32);
    while at + 4 <= data.len() {
        h = h
            .wrapping_add(word(&data[at..]).wrapping_mul(P3))
            .rotate_left(17)
            .wrapping_mul(P4);
        at += 4;
    }
    for &byte in &data[at..] {
        h = h
            .wrapping_add((byte as u32).wrapping_mul(P5))
            .rotate_left(11)
            .wrapping_mul(P1);
    }
    h ^= h >> 15;
    h = h.wrapping_mul(P2);
    h ^= h >> 13;
    h = h.wrapping_mul(P3);
    h ^ (h >> 16)
}

const IV: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const PERMUTE: [usize; 16] = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];

fn mix(s: &mut [u32; 16], a: usize, b: usize, c: usize, d: usize, x: u32, y: u32) {
    s[a] = s[a].wrapping_add(s[b]).wrapping_add(x);
    s[d] = (s[d] ^ s[a]).rotate_right(16);
    s[c] = s[c].wrapping_add(s[d]);
    s[b] = (s[b] ^ s[c]).rotate_right(12);
    s[a] = s[a].wrapping_add(s[b]).wrapping_add(y);
    s[d] = (s[d] ^ s[a]).rotate_right(8);
    s[c] = s[c].wrapping_add(s[d]);
    s[b] = (s[b] ^ s[c]).rotate_right(7);
}

// CHUNK_START=1, CHUNK_END=2, PARENT=4, ROOT=8. Only eight output words
// are needed for chaining values and the fixed 32-byte root digest.
fn compress(cv: [u32; 8], mut m: [u32; 16], counter: u64, length: usize, flags: u32) -> [u32; 8] {
    let mut s = [0; 16];
    s[..8].copy_from_slice(&cv);
    s[8..12].copy_from_slice(&IV[..4]);
    s[12] = counter as u32;
    s[13] = (counter >> 32) as u32;
    s[14] = length as u32;
    s[15] = flags;
    for round in 0..7 {
        mix(&mut s, 0, 4, 8, 12, m[0], m[1]);
        mix(&mut s, 1, 5, 9, 13, m[2], m[3]);
        mix(&mut s, 2, 6, 10, 14, m[4], m[5]);
        mix(&mut s, 3, 7, 11, 15, m[6], m[7]);
        mix(&mut s, 0, 5, 10, 15, m[8], m[9]);
        mix(&mut s, 1, 6, 11, 12, m[10], m[11]);
        mix(&mut s, 2, 7, 8, 13, m[12], m[13]);
        mix(&mut s, 3, 4, 9, 14, m[14], m[15]);
        if round != 6 {
            m = core::array::from_fn(|i| m[PERMUTE[i]]);
        }
    }
    core::array::from_fn(|i| s[i] ^ s[i + 8])
}

/// One-shot BLAKE3-256, covering empty input, exact block ends and full trees.
/// This deliberately exposes neither keyed hashing, KDF nor variable output.
pub fn blake3(data: &[u8]) -> [u8; 32] {
    let chunks = data.len().div_ceil(1024).max(1);
    // At most 64 tree levels cover every addressable input length. Keeping
    // this fixed stack local removes the per-hash allocation and also lets the
    // Wasm backend use the same code without a general-purpose allocator.
    let mut stack = [[0u32; 8]; 64];
    let mut depth = 0usize;
    let mut cv = IV;
    for chunk in 0..chunks {
        cv = IV;
        let part = &data[(chunk * 1024).min(data.len())..((chunk + 1) * 1024).min(data.len())];
        let blocks = part.len().div_ceil(64).max(1);
        for b in 0..blocks {
            let block = &part[(b * 64).min(part.len())..((b + 1) * 64).min(part.len())];
            let mut padded = [0; 64];
            padded[..block.len()].copy_from_slice(block);
            let words = core::array::from_fn(|i| {
                u32::from_le_bytes(padded[4 * i..4 * i + 4].try_into().unwrap())
            });
            let flags = u32::from(b == 0)
                | (u32::from(b == blocks - 1) << 1)
                | if chunk == chunks - 1 && depth == 0 && b == blocks - 1 {
                    8
                } else {
                    0
                };
            cv = compress(cv, words, chunk as u64, block.len(), flags);
        }
        if chunk == chunks - 1 {
            while depth != 0 {
                depth -= 1;
                let left = stack[depth];
                let mut words = [0; 16];
                words[..8].copy_from_slice(&left);
                words[8..].copy_from_slice(&cv);
                cv = compress(IV, words, 0, 64, 4 | if depth == 0 { 8 } else { 0 });
            }
        } else {
            let mut completed = chunk + 1;
            while completed & 1 == 0 {
                let mut words = [0; 16];
                depth -= 1;
                words[..8].copy_from_slice(&stack[depth]);
                words[8..].copy_from_slice(&cv);
                cv = compress(IV, words, 0, 64, 4);
                completed >>= 1;
            }
            stack[depth] = cv;
            depth += 1;
        }
    }
    let mut digest = [0; 32];
    for (word, bytes) in cv.iter().zip(digest.chunks_exact_mut(4)) {
        bytes.copy_from_slice(&word.to_le_bytes());
    }
    digest
}
