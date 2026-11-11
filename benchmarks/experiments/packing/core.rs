//! 0BSD, NeoX. Experimental radix transport decoders, shared by native tests and
//! Wasm. No allocation, host calls, floating point, or adaptive entropy model.
pub const STATE_L: u32 = 1 << 23;
pub const INVALID: u32 = 1;
pub trait Digits {
    fn read(&mut self) -> Result<u16, u32>;
    fn remaining(&self) -> usize;
}
pub struct Slice<'a> {
    pub data: &'a [u8],
    pub at: usize,
    pub radix: u32,
}
impl Digits for Slice<'_> {
    #[inline(always)]
    fn read(&mut self) -> Result<u16, u32> {
        let d = *self.data.get(self.at).ok_or(INVALID)?;
        self.at += 1;
        if u32::from(d) >= self.radix {
            return Err(INVALID);
        }
        Ok(u16::from(d))
    }
    fn remaining(&self) -> usize {
        self.data.len() - self.at
    }
}
pub struct Words<'a> {
    pub data: &'a [u16],
    pub at: usize,
    pub radix: u32,
}
impl Digits for Words<'_> {
    fn read(&mut self) -> Result<u16, u32> {
        let d = *self.data.get(self.at).ok_or(INVALID)?;
        self.at += 1;
        if u32::from(d) >= self.radix {
            return Err(INVALID);
        }
        Ok(d)
    }
    fn remaining(&self) -> usize {
        self.data.len() - self.at
    }
}
#[inline(always)]
pub fn number<D: Digits>(input: &mut D, n: usize, radix: u32) -> Result<u64, u32> {
    let mut value = 0u64;
    let mut power = 1u64;
    for _ in 0..n {
        value += u64::from(input.read()?) * power;
        power *= u64::from(radix);
    }
    Ok(value)
}
#[inline(always)]
fn byte(out: &mut [u8], at: &mut usize, raw: u8, mask: u8) -> Result<(), u32> {
    if *at < out.len() {
        out[*at] = raw ^ mask
    } else if raw != 0 {
        return Err(INVALID);
    }
    *at += 1;
    Ok(())
}

/// A full K-digit group fits in u64. Retain at most seven bits between groups.
/// Separate the overflow bucket for 64-bit groups instead of using u128 in Wasm.
#[inline(always)]
fn groups<const K: usize, const B: u32, D: Digits>(
    input: &mut D,
    out: &mut [u8],
    mask: u8,
    radix: u32,
) -> Result<(), u32> {
    if input.remaining() % K != 0 {
        return Err(INVALID);
    }
    let capacity = (0..K).fold(1u128, |v, _| v * u128::from(radix));
    let threshold = (capacity - (1u128 << (B - 1)) - 1) as u64;
    let low_mask = (1u64 << (B - 1)) - 1;
    let xor = u64::from(mask) * 0x0101010101010101;
    let (mut carry, mut shift, mut at) = (0u64, 0u32, 0usize);
    while input.remaining() > 0 {
        if at >= out.len() {
            return Err(INVALID);
        }
        let value = number(input, K, radix)?;
        let narrow = value & low_mask > threshold;
        let total = shift + B - u32::from(narrow);
        let advance = (total / 8) as usize;
        let raw = carry | (value << shift);
        let extra = if B == 64 && shift > 0 {
            value >> (64 - shift)
        } else {
            0
        };
        // All interior bytes are known available. Unaligned stores preserve
        // byte order after narrow transitions. Tail writes check zero padding.
        if at + (B / 8) as usize <= out.len() {
            let plain = raw ^ xor;
            unsafe {
                match B / 8 {
                    2 => (out.as_mut_ptr().add(at) as *mut u16)
                        .write_unaligned((plain as u16).to_le()),
                    4 => (out.as_mut_ptr().add(at) as *mut u32)
                        .write_unaligned((plain as u32).to_le()),
                    6 => {
                        (out.as_mut_ptr().add(at) as *mut u32)
                            .write_unaligned((plain as u32).to_le());
                        (out.as_mut_ptr().add(at + 4) as *mut u16)
                            .write_unaligned(((plain >> 32) as u16).to_le());
                    }
                    8 => (out.as_mut_ptr().add(at) as *mut u64).write_unaligned(plain.to_le()),
                    _ => return Err(INVALID),
                }
            }
            at += advance;
        } else {
            for j in 0..advance {
                byte(out, &mut at, (raw >> (8 * j)) as u8, mask)?;
            }
        }
        carry = if advance == 8 {
            extra
        } else {
            raw >> (8 * advance)
        };
        shift = total % 8;
    }
    if at < out.len() || carry != 0 {
        return Err(INVALID);
    }
    Ok(())
}

/// Fixed 703-bit blocks in 88 base-254 digits. This approaches the radix bound
/// but needs multiword arithmetic. It is a density/performance control.
#[inline(always)]
fn blocks<D: Digits>(input: &mut D, out: &mut [u8], mask: u8) -> Result<(), u32> {
    let count = (out.len() * 8).div_ceil(703);
    if input.remaining() != count * 88 {
        return Err(INVALID);
    }
    let (mut at, mut queue, mut bits) = (0usize, 0u64, 0u32);
    for _ in 0..count {
        let mut digits = [0u8; 88];
        for d in &mut digits {
            *d = input.read()? as u8;
        }
        let mut limbs = [0u32; 22];
        for &d in digits.iter().rev() {
            let mut carry = u64::from(d);
            for limb in &mut limbs {
                let v = u64::from(*limb) * 254 + carry;
                *limb = v as u32;
                carry = v >> 32;
            }
            if carry != 0 {
                return Err(INVALID);
            }
        }
        if limbs[21] & 0x80000000 != 0 {
            return Err(INVALID);
        }
        for (i, limb) in limbs.into_iter().enumerate() {
            queue |= u64::from(limb) << bits;
            bits += if i == 21 { 31 } else { 32 };
            while bits >= 8 {
                byte(out, &mut at, queue as u8, mask)?;
                queue >>= 8;
                bits -= 8;
            }
        }
    }
    if at < out.len() || queue != 0 {
        return Err(INVALID);
    }
    Ok(())
}

/// Uniform 256-symbol rANS using radix-R source digits. x stays in [L,R*L),
/// below 2^31 for R<=254. Each byte consumes one or (rarely) two digits.
#[inline(always)]
fn ans<const LANES: usize, D: Digits>(
    input: &mut D,
    out: &mut [u8],
    mask: u8,
    radix: u32,
) -> Result<(), u32> {
    let lower = if radix > 256 { 1 << 15 } else { STATE_L };
    let state_digits = if radix > 256 { 2 } else { 4 };
    let state_units = LANES * state_digits;
    if input.remaining() < state_units
        || out.len()
            > if radix > 256 {
                (input.remaining() - state_units) * 2 + LANES
            } else {
                input.remaining() - state_units
            }
    {
        return Err(INVALID);
    }
    let mut states = [0u32; LANES];
    for state in &mut states {
        *state = number(input, state_digits, radix)? as u32;
        if *state < lower || *state >= radix * lower {
            return Err(INVALID);
        }
    }
    let mut at = 0;
    while at + LANES <= out.len() {
        // LANES is compile-time constant, exposing independent state chains.
        for state in &mut states {
            out[at] = (*state as u8) ^ mask;
            at += 1;
            let mut x = *state >> 8;
            if radix <= 256 || x < lower {
                x = x * radix + u32::from(input.read()?);
            }
            if x < lower {
                x = x * radix + u32::from(input.read()?);
            }
            *state = x;
        }
    }
    for state in states.iter_mut().take(out.len() - at) {
        out[at] = (*state as u8) ^ mask;
        at += 1;
        let mut x = *state >> 8;
        if radix <= 256 || x < lower {
            x = x * radix + u32::from(input.read()?);
        }
        if x < lower {
            x = x * radix + u32::from(input.read()?);
        }
        *state = x;
    }
    if input.remaining() != 0 || states.iter().any(|&x| x != lower) {
        return Err(INVALID);
    }
    Ok(())
}
/// Decode uniform 16-bit symbols with four independent state chains. The
/// precise version uses a 47-bit state, still safe in JS Number and Wasm u64.
#[inline(always)]
fn ans_words<const PRECISE: bool, D: Digits>(
    input: &mut D,
    out: &mut [u8],
    mask: u8,
    radix: u32,
) -> Result<(), u32> {
    let lower = if PRECISE { 1u64 << 31 } else { 1u64 << 16 };
    let state_digits = 3;
    if input.remaining() < 4 * state_digits + out.len().div_ceil(2) {
        return Err(INVALID);
    }
    let mut states = [0u64; 4];
    for state in &mut states {
        *state = number(input, state_digits, radix)?;
        if *state < lower || *state >= lower * u64::from(radix) {
            return Err(INVALID);
        }
    }
    let xor = u16::from(mask) * 257;
    let mut at = 0;
    while at + 8 <= out.len() {
        for state in &mut states {
            unsafe {
                (out.as_mut_ptr().add(at) as *mut u16)
                    .write_unaligned(((*state as u16) ^ xor).to_le());
            }
            at += 2;
            let mut x = (*state >> 16) * u64::from(radix) + u64::from(input.read()?);
            if x < lower {
                x = x * u64::from(radix) + u64::from(input.read()?);
            }
            *state = x;
        }
    }
    let remaining = (out.len() - at).div_ceil(2);
    for state in states.iter_mut().take(remaining) {
        let word = *state as u16;
        byte(out, &mut at, word as u8, mask)?;
        byte(out, &mut at, (word >> 8) as u8, mask)?;
        let mut x = (*state >> 16) * u64::from(radix) + u64::from(input.read()?);
        if x < lower {
            x = x * u64::from(radix) + u64::from(input.read()?);
        }
        *state = x;
    }
    if input.remaining() != 0 || states.iter().any(|&x| x != lower) {
        return Err(INVALID);
    }
    Ok(())
}
#[inline(always)]
pub fn decode<D: Digits>(
    input: &mut D,
    out: &mut [u8],
    mask: u8,
    radix: u32,
    method: u32,
) -> Result<(), u32> {
    match method {
        0 if radix > 256 => groups::<2, 32, _>(input, out, mask, radix),
        0 => groups::<2, 16, _>(input, out, mask, radix),
        1 => groups::<4, 32, _>(input, out, mask, radix),
        2 => groups::<6, 48, _>(input, out, mask, radix),
        3 => groups::<8, 64, _>(input, out, mask, radix),
        4 if radix == 254 => blocks(input, out, mask),
        5 => ans::<1, _>(input, out, mask, radix),
        6 => ans::<4, _>(input, out, mask, radix),
        8 if radix > 256 => ans_words::<false, _>(input, out, mask, radix),
        9 if radix > 256 => ans_words::<true, _>(input, out, mask, radix),
        _ => Err(INVALID),
    }
}
