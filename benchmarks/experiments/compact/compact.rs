//! 0BSD, NeoX. Matched-alphabet ANS experiment. This module is injected into a
//! COPY of the production kernel, retaining its arena, verifier and public ABI.
//! Profiles 0..4 select word4/word1/word2/word8 precise or word4 low precision.
const R: u64 = 63385;

pub fn supports(profile: u32) -> bool {
    (cfg!(feature = "ans4") && profile == 0)
        || (cfg!(feature = "ans1") && profile == 1)
        || (cfg!(feature = "ans2") && profile == 2)
        || (cfg!(feature = "ans8") && profile == 3)
        || (cfg!(feature = "ans-low") && profile == 4)
}

// Separate integer types let the low-precision candidate actually use i32
// arithmetic. Every mandatory state bound and terminal check remains present
// even when optional character verification is disabled.
macro_rules! unpacker {
    ($name:ident,$word:ty,$lower:expr) => {
        #[allow(dead_code)]
        fn $name<const FORMAT: bool, const LANES: usize>(
            text: &[u16],
            mut pos: usize,
            out: &mut [u8],
            mask: u8,
            table: &[u16],
        ) -> u32 {
            const L: $word = $lower;
            if text.len() - pos < LANES * 3 + out.len().div_ceil(2) {
                return super::LENGTH;
            }
            #[inline(always)]
            fn digit<const F: bool>(
                text: &[u16],
                pos: &mut usize,
                table: &[u16],
            ) -> Result<u64, u32> {
                let Some(&c) = text.get(*pos) else {
                    return Err(super::LENGTH);
                };
                *pos += 1;
                let d = table[c as usize];
                if F && d == 0 {
                    return Err(super::CHARACTER);
                }
                Ok(u64::from(d).wrapping_sub(1))
            }
            let mut states = [0 as $word; LANES];
            for state in &mut states {
                let mut x = 0u64;
                let mut power = 1u64;
                for _ in 0..3 {
                    let d = match digit::<FORMAT>(text, &mut pos, table) {
                        Ok(d) => d,
                        Err(e) => return e,
                    };
                    x = x.wrapping_add(d.wrapping_mul(power));
                    power *= R;
                }
                if x < u64::from(L) || x >= u64::from(L) * R {
                    return super::HEADER;
                }
                *state = x as $word;
            }
            let xor = u16::from(mask) * 257;
            let mut at = 0;
            while at + LANES * 2 <= out.len() {
                // LANES is constant: Binaryen/V8 can schedule independent chains.
                for state in &mut states {
                    let word = (*state as u16) ^ xor;
                    // SAFETY: the loop proves that all LANES complete u16
                    // stores fit. Wasm permits unaligned little-endian stores.
                    unsafe {
                        out.as_mut_ptr()
                            .add(at)
                            .cast::<u16>()
                            .write_unaligned(word.to_le())
                    };
                    at += 2;
                    let d = match digit::<FORMAT>(text, &mut pos, table) {
                        Ok(d) => d as $word,
                        Err(e) => return e,
                    };
                    let mut x = (*state >> 16).wrapping_mul(R as $word).wrapping_add(d);
                    if x < L {
                        let d = match digit::<FORMAT>(text, &mut pos, table) {
                            Ok(d) => d as $word,
                            Err(e) => return e,
                        };
                        x = x.wrapping_mul(R as $word).wrapping_add(d);
                    }
                    *state = x;
                }
            }
            let remaining = (out.len() - at).div_ceil(2);
            for state in states.iter_mut().take(remaining) {
                let word = *state as u16;
                out[at] = (word as u8) ^ mask;
                at += 1;
                if at < out.len() {
                    out[at] = ((word >> 8) as u8) ^ mask;
                    at += 1
                } else if word >> 8 != 0 {
                    return super::PADDING;
                }
                let d = match digit::<FORMAT>(text, &mut pos, table) {
                    Ok(d) => d as $word,
                    Err(e) => return e,
                };
                let mut x = (*state >> 16).wrapping_mul(R as $word).wrapping_add(d);
                if x < L {
                    let d = match digit::<FORMAT>(text, &mut pos, table) {
                        Ok(d) => d as $word,
                        Err(e) => return e,
                    };
                    x = x.wrapping_mul(R as $word).wrapping_add(d);
                }
                *state = x;
            }
            if pos != text.len() || states.iter().any(|&x| x != L) {
                return super::PADDING;
            }
            0
        }
    };
}
unpacker!(precise, u64, 1 << 31);
unpacker!(small, u32, 1 << 16);

pub fn unpack(
    text: &[u16],
    start: usize,
    out: &mut [u8],
    mask: u8,
    table: &[u16],
    format: bool,
    profile: u32,
) -> u32 {
    macro_rules! run {
        ($f:ident,$lanes:expr) => {
            if format {
                $f::<true, $lanes>(text, start, out, mask, table)
            } else {
                $f::<false, $lanes>(text, start, out, mask, table)
            }
        };
    }
    match profile {
        #[cfg(feature = "ans4")]
        0 => run!(precise, 4),
        #[cfg(feature = "ans1")]
        1 => run!(precise, 1),
        #[cfg(feature = "ans2")]
        2 => run!(precise, 2),
        #[cfg(feature = "ans8")]
        3 => run!(precise, 8),
        #[cfg(feature = "ans-low")]
        4 => run!(small, 4),
        _ => super::HEADER,
    }
}
