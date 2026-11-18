//! Uniform 16-bit rANS with four independent 47-bit states. No JS BigInt or
//! additional browser feature is needed: state arithmetic stays inside Wasm.
use super::{read_digit, HEADER, LENGTH, PADDING};
const R: u64 = 63385;
const L: u64 = 1 << 31;
pub fn unpack<const FORMAT: bool>(
    text: &[u16],
    mut pos: usize,
    out: &mut [u8],
    mask: u8,
    table: &[u16],
) -> u32 {
    if text.len() - pos < 12 + out.len().div_ceil(2) {
        return LENGTH;
    }
    let mut states = [0u64; 4];
    for x in &mut states {
        let (mut value, mut power) = (0u64, 1u64);
        for _ in 0..3 {
            let d = match read_digit::<FORMAT>(text, &mut pos, table) {
                Ok(v) => v,
                Err(e) => return e,
            };
            value = value.wrapping_add(d.wrapping_mul(power));
            power *= R;
        }
        if !(L..L * R).contains(&value) {
            return HEADER;
        }
        *x = value;
    }
    #[inline(always)]
    fn norm<const F: bool>(s: u64, t: &[u16], p: &mut usize, a: &[u16]) -> Result<u64, u32> {
        let mut x = (s >> 16)
            .wrapping_mul(R)
            .wrapping_add(read_digit::<F>(t, p, a)?);
        if x < L {
            x = x.wrapping_mul(R).wrapping_add(read_digit::<F>(t, p, a)?)
        }
        Ok(x)
    }
    let xor = u16::from(mask) * 257;
    let mut at = 0;
    while at + 8 <= out.len() {
        for x in &mut states {
            let word = (*x as u16) ^ xor;
            // SAFETY: the outer eight-byte bound covers all four two-byte
            // stores. Wasm permits unaligned little-endian memory accesses.
            unsafe {
                out.as_mut_ptr()
                    .add(at)
                    .cast::<u16>()
                    .write_unaligned(word.to_le())
            }
            at += 2;
            *x = match norm::<FORMAT>(*x, text, &mut pos, table) {
                Ok(v) => v,
                Err(e) => return e,
            };
        }
    }
    let left = (out.len() - at).div_ceil(2);
    for x in states.iter_mut().take(left) {
        let word = *x as u16;
        out[at] = (word as u8) ^ mask;
        at += 1;
        if at < out.len() {
            out[at] = ((word >> 8) as u8) ^ mask;
            at += 1
        } else if word >> 8 != 0 {
            return PADDING;
        }
        *x = match norm::<FORMAT>(*x, text, &mut pos, table) {
            Ok(v) => v,
            Err(e) => return e,
        };
    }
    if pos != text.len() || states.iter().any(|&x| x != L) {
        return PADDING;
    }
    0
}
