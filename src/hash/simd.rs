//! Four independent BLAKE3 chunks in 128-bit SIMD lanes. Only complete,
//! non-final chunks enter here: scalar code retains all tail/root semantics.
//! Message words are transposed once per block; no byte gathers or alignment
//! assumptions enter the compression rounds. No relaxed-SIMD instructions.
use super::IV;
use core::arch::wasm32::*;

#[inline(always)]
fn mix(s: &mut [v128; 16], a: usize, b: usize, c: usize, d: usize, x: v128, y: v128) {
    s[a] = u32x4_add(u32x4_add(s[a], s[b]), x);
    s[d] = v128_xor(s[d], s[a]);
    s[d] = i8x16_shuffle::<2, 3, 0, 1, 6, 7, 4, 5, 10, 11, 8, 9, 14, 15, 12, 13>(s[d], s[d]);
    s[c] = u32x4_add(s[c], s[d]);
    s[b] = v128_xor(s[b], s[c]);
    s[b] = v128_or(u32x4_shr(s[b], 12), u32x4_shl(s[b], 20));
    s[a] = u32x4_add(u32x4_add(s[a], s[b]), y);
    s[d] = v128_xor(s[d], s[a]);
    s[d] = i8x16_shuffle::<1, 2, 3, 0, 5, 6, 7, 4, 9, 10, 11, 8, 13, 14, 15, 12>(s[d], s[d]);
    s[c] = u32x4_add(s[c], s[d]);
    s[b] = v128_xor(s[b], s[c]);
    s[b] = v128_or(u32x4_shr(s[b], 7), u32x4_shl(s[b], 25));
}

pub(super) fn hash_four(data: &[u8], first_chunk: usize) -> [[u32; 8]; 4] {
    assert!(data.len() >= 4096);
    let mut cv = IV.map(|word| u32x4_splat(word));
    for block in 0..16 {
        let mut m = [u32x4_splat(0); 16];
        // Transpose four 4-word rows into SIMD columns. Each load remains inside
        // one of the four full 1024-byte chunks proven by the caller and assert.
        for group in 0..4 {
            let at = block * 64 + group * 16;
            let (a, b, c, d) = unsafe {
                (
                    v128_load(data.as_ptr().add(at).cast()),
                    v128_load(data.as_ptr().add(at + 1024).cast()),
                    v128_load(data.as_ptr().add(at + 2048).cast()),
                    v128_load(data.as_ptr().add(at + 3072).cast()),
                )
            };
            let ab0 = i32x4_shuffle::<0, 4, 1, 5>(a, b);
            let ab1 = i32x4_shuffle::<2, 6, 3, 7>(a, b);
            let cd0 = i32x4_shuffle::<0, 4, 1, 5>(c, d);
            let cd1 = i32x4_shuffle::<2, 6, 3, 7>(c, d);
            m[group * 4] = i32x4_shuffle::<0, 1, 4, 5>(ab0, cd0);
            m[group * 4 + 1] = i32x4_shuffle::<2, 3, 6, 7>(ab0, cd0);
            m[group * 4 + 2] = i32x4_shuffle::<0, 1, 4, 5>(ab1, cd1);
            m[group * 4 + 3] = i32x4_shuffle::<2, 3, 6, 7>(ab1, cd1);
        }
        let mut s = [u32x4_splat(0); 16];
        s[..8].copy_from_slice(&cv);
        for i in 0..4 {
            s[8 + i] = u32x4_splat(IV[i]);
        }
        let counter = first_chunk as u32;
        s[12] = u32x4(counter, counter + 1, counter + 2, counter + 3);
        // wasm32 inputs cannot contain enough chunks for a nonzero high counter.
        s[13] = u32x4_splat(0);
        s[14] = u32x4_splat(64);
        s[15] = u32x4_splat(u32::from(block == 0) | (u32::from(block == 15) << 1));
        macro_rules! round {
            ($a:expr,$b:expr,$c:expr,$d:expr,$e:expr,$f:expr,$g:expr,$h:expr,$i:expr,$j:expr,$k:expr,$l:expr,$n:expr,$o:expr,$p:expr,$q:expr) => {
                mix(&mut s, 0, 4, 8, 12, m[$a], m[$b]);
                mix(&mut s, 1, 5, 9, 13, m[$c], m[$d]);
                mix(&mut s, 2, 6, 10, 14, m[$e], m[$f]);
                mix(&mut s, 3, 7, 11, 15, m[$g], m[$h]);
                mix(&mut s, 0, 5, 10, 15, m[$i], m[$j]);
                mix(&mut s, 1, 6, 11, 12, m[$k], m[$l]);
                mix(&mut s, 2, 7, 8, 13, m[$n], m[$o]);
                mix(&mut s, 3, 4, 9, 14, m[$p], m[$q]);
            };
        }
        for round in 0..7 {
            round!(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
            if round != 6 {
                const PERMUTE: [usize; 16] = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
                m = core::array::from_fn(|i| m[PERMUTE[i]]);
            }
        }
        for i in 0..8 {
            cv[i] = v128_xor(s[i], s[i + 8]);
        }
    }
    let mut out = [[0; 8]; 4];
    for (i, vector) in cv.into_iter().enumerate() {
        let mut lanes = [0u32; 4];
        // The destination has exactly the 16 bytes written by this store.
        unsafe {
            v128_store(lanes.as_mut_ptr().cast(), vector);
        }
        for lane in 0..4 {
            out[lane][i] = lanes[lane];
        }
    }
    out
}
