//! 0BSD, NeoX. Inverse of the UTF-8 rANS channel. No lookup or bigint tables.
//! The 38-bit state renormalizes below F*2^15. With F<=58821 that is below
//! 2^31, so the expensive quotient is a 32-bit CONSTANT division, intentionally
//! specialized by frequency. Benchmarked against i64 and floating quotients.
use super::{CHARACTER, LENGTH, PADDING};
#[inline(always)]
fn step<const F: u32, const C: u64>(
    mut x: u64,
    d: u32,
    out: &mut [u8],
    at: &mut usize,
    mask: u8,
) -> Result<u64, u32> {
    while x >= u64::from(F) << 15 {
        if *at == 0 {
            return Err(LENGTH);
        }
        *at -= 1;
        out[*at] = (x as u8) ^ mask;
        x >>= 8;
    }
    let value = x as u32;
    let quotient = value / F;
    Ok((u64::from(quotient) << 23)
        + u64::from(value - quotient * F)
        + C
        + u64::from(d) * u64::from(F))
}
pub fn unpack<const FORMAT: bool>(input: &[u16], out: &mut [u8], mut x: u64, mask: u8) -> u32 {
    // Canonical termination: encoding stops immediately after consuming the
    // last input byte. Therefore the first inverse step must emit a byte.
    // Do this once outside the hot loop; unchecked text may omit this rule.
    if FORMAT {
        if let Some(&cp) = input.last() {
            let cp = u32::from(cp);
            let f = if cp < 128 {
                if cp == 0 || cp == 13 {
                    return CHARACTER;
                }
                let d = cp - 1 - u32::from(cp > 13);
                if d < 110 {
                    58821u64
                } else {
                    58820
                }
            } else if cp < 2048 {
                413
            } else {
                if (0xd800..0xe000).contains(&cp) || (0xfdd0..=0xfdef).contains(&cp) || cp >= 65534
                {
                    return CHARACTER;
                }
                3
            };
            if out.is_empty() || x < f << 15 {
                return PADDING;
            }
        }
    }
    let mut at = out.len();
    for &c in input.iter().rev() {
        let cp = u32::from(c);
        let next = if cp < 128 {
            if cp == 0 || cp == 13 {
                return CHARACTER;
            }
            let d = cp - 1 - u32::from(cp > 13);
            if d < 110 {
                step::<58821, 0>(x, d, out, &mut at, mask)
            } else {
                step::<58820, 6470310>(x, d - 110, out, &mut at, mask)
            }
        } else if cp < 2048 {
            step::<413, 7411430>(x, cp - 128, out, &mut at, mask)
        } else {
            if (0xd800..0xe000).contains(&cp) || (0xfdd0..=0xfdef).contains(&cp) || cp >= 65534 {
                return CHARACTER;
            }
            let d =
                cp - 2048 - if cp >= 57344 { 2048 } else { 0 } - if cp >= 65008 { 32 } else { 0 };
            step::<3, 8204390>(x, d, out, &mut at, mask)
        };
        match next {
            Ok(v) => x = v,
            Err(status) => return status,
        }
    }
    // Terminal state and exact decoded coverage are structural necessities, not
    // optional text canonicality. This also rejects missing/spurious symbols.
    if at != 0 {
        return LENGTH;
    }
    if x != 1 << 30 {
        return PADDING;
    }
    0
}
