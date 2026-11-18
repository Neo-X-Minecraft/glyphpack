//! Uniform byte rANS with four u32 states and 254 Windows-1252 source symbols.
use super::{read_digit, HEADER, LENGTH, PADDING};
const R: u32 = 254;
const L: u32 = 1 << 23;
pub fn unpack<const FORMAT: bool>(
    text: &[u16],
    mut pos: usize,
    out: &mut [u8],
    mask: u8,
    table: &[u16],
) -> u32 {
    if text.len() - pos < 16 + out.len() {
        return LENGTH;
    }
    let mut states = [0u32; 4];
    for x in &mut states {
        let (mut value, mut power) = (0u64, 1u64);
        for _ in 0..4 {
            let d = match read_digit::<FORMAT>(text, &mut pos, table) {
                Ok(v) => v,
                Err(e) => return e,
            };
            value = value.wrapping_add(d.wrapping_mul(power));
            power *= u64::from(R);
        }
        if !(u64::from(L)..u64::from(L) * u64::from(R)).contains(&value) {
            return HEADER;
        }
        *x = value as u32;
    }
    #[inline(always)]
    fn norm<const F: bool>(s: u32, t: &[u16], p: &mut usize, a: &[u16]) -> Result<u32, u32> {
        let mut x = (s >> 8)
            .wrapping_mul(R)
            .wrapping_add(read_digit::<F>(t, p, a)? as u32);
        if x < L {
            x = x
                .wrapping_mul(R)
                .wrapping_add(read_digit::<F>(t, p, a)? as u32)
        }
        Ok(x)
    }
    let xor = u32::from(mask) * 0x01010101;
    let mut at = 0;
    while at + 4 <= out.len() {
        let word = (states[0] & 255)
            | ((states[1] & 255) << 8)
            | ((states[2] & 255) << 16)
            | (states[3] << 24);
        for x in &mut states {
            *x = match norm::<FORMAT>(*x, text, &mut pos, table) {
                Ok(v) => v,
                Err(e) => return e,
            };
        }
        // SAFETY: the loop reserves four output bytes at this offset.
        unsafe {
            out.as_mut_ptr()
                .add(at)
                .cast::<u32>()
                .write_unaligned((word ^ xor).to_le())
        }
        at += 4;
    }
    let left = out.len() - at;
    for x in states.iter_mut().take(left) {
        out[at] = (*x as u8) ^ mask;
        at += 1;
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
