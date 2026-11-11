//! 0BSD, NeoX. Uniform byte rANS, four independent u32 states. This experiment
//! shares the production allocator, verifier, adapter and selected data policy.
const R: u32 = if cfg!(feature = "nul-free") { 253 } else { 254 };
const L: u32 = 1 << 23;
#[inline(always)]
fn digit<const FORMAT: bool>(text: &[u16], pos: &mut usize, table: &[u16]) -> Result<u32, u32> {
    let Some(&c) = text.get(*pos) else {
        return Err(super::LENGTH);
    };
    *pos += 1;
    let d = table[c as usize];
    if FORMAT && d == 0 {
        return Err(super::CHARACTER);
    }
    Ok(u32::from(d).wrapping_sub(1))
}
pub fn unpack<const FORMAT: bool>(
    text: &[u16],
    mut pos: usize,
    out: &mut [u8],
    mask: u8,
    table: &[u16],
) -> u32 {
    // Every byte must consume at least one body digit. State storage cannot
    // be used to amplify allocation from a header without any encoded body.
    if text.len() - pos < 16 + out.len() {
        return super::LENGTH;
    }
    let mut states = [0u32; 4];
    for x in &mut states {
        let mut value = 0u64;
        let mut power = 1u64;
        for _ in 0..4 {
            let d = match digit::<FORMAT>(text, &mut pos, table) {
                Ok(d) => d,
                Err(e) => return e,
            };
            value = value.wrapping_add(u64::from(d) * power);
            power *= u64::from(R);
        }
        if value < u64::from(L) || value >= u64::from(L) * u64::from(R) {
            return super::HEADER;
        }
        *x = value as u32;
    }
    #[inline(always)]
    fn normalize<const F: bool>(
        state: u32,
        text: &[u16],
        pos: &mut usize,
        table: &[u16],
    ) -> Result<u32, u32> {
        let mut x = (state >> 8)
            .wrapping_mul(R)
            .wrapping_add(digit::<F>(text, pos, table)?);
        if x < L {
            x = x
                .wrapping_mul(R)
                .wrapping_add(digit::<F>(text, pos, table)?)
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
            *x = match normalize::<FORMAT>(*x, text, &mut pos, table) {
                Ok(x) => x,
                Err(e) => return e,
            };
        }
        // SAFETY: the loop proves a complete four-byte output word fits.
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
        *x = match normalize::<FORMAT>(*x, text, &mut pos, table) {
            Ok(x) => x,
            Err(e) => return e,
        };
    }
    if pos != text.len() || states.iter().any(|&x| x != L) {
        return super::PADDING;
    }
    0
}
