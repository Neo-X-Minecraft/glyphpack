//! Bulk little-endian stores with the same carry, byte coverage and padding
//! semantics as the JS core. Const generics remove format/heavy branches from
//! each specialized hot loop; dispatch happens once per decoded packet.
const THRESHOLD: u32 = 1870174576;

#[derive(Default)]
struct Bits {
    carry: u32,
    shift: u32,
    at: usize,
    last_word: u32,
    last_width: usize,
    covered: usize,
}

#[inline(always)]
fn pair<const FORMAT: bool, const HEAVY: bool>(
    text: &[u16],
    pos: usize,
    table: &[u16],
    high: &[u32],
    state: &mut Bits,
) -> Result<u32, u32> {
    let lo = table[text[pos] as usize];
    let hi = text.get(pos + 1).map(|&c| {
        if HEAVY {
            high[c as usize]
        } else {
            u32::from(table[c as usize])
        }
    });
    if FORMAT && (lo == 0 || hi == Some(0) || hi.is_none()) {
        return Err(super::CHARACTER);
    }
    // A missing high character produces NaN in JS, whose bitwise consumers
    // produce zero. An existing invalid digit is zero and retains its negative
    // arithmetic contribution modulo 2^32. Keep those cases distinct.
    let value = match hi {
        None => 0,
        Some(y) if HEAVY => u32::from(lo)
            .wrapping_add(y)
            .wrapping_sub(2)
            .wrapping_sub(if y == 0 { 63384 } else { 0 }),
        Some(y) => u32::from(lo)
            .wrapping_add(63385u32.wrapping_mul(y))
            .wrapping_sub(63386),
    };
    let word = state.carry | (value << state.shift);
    state.last_word = word;
    let narrow = (value & 0x7fffffff) > THRESHOLD;
    if state.shift == 0 {
        if narrow {
            state.carry = word >> 24;
            state.shift = 7;
            state.at += 3;
            state.last_width = 3;
        } else {
            state.carry = 0;
            state.at += 4;
            state.last_width = 4;
        }
    } else {
        state.carry = value >> (32 - state.shift);
        state.shift -= u32::from(narrow);
        state.at += 4;
        state.last_width = 4;
    }
    Ok(word)
}

#[inline(always)]
fn full<const FORMAT: bool, const HEAVY: bool>(
    text: &[u16],
    pos: usize,
    out: &mut [u8],
    table: &[u16],
    high: &[u32],
    state: &mut Bits,
    mask: u32,
) -> Result<(), u32> {
    let at = state.at;
    let word = pair::<FORMAT, HEAVY>(text, pos, table, high, state)? ^ mask;
    // SAFETY: the bulk loop proves at+16 <= out.len() before four stores.
    // Every pair advances by at most four bytes. Wasm i32.store supports an
    // unaligned address; explicit LE conversion keeps the native model valid.
    unsafe {
        core::ptr::write_unaligned(out.as_mut_ptr().add(at).cast::<u32>(), word.to_le());
    }
    state.covered = at + 4;
    Ok(())
}

pub fn unpack<const FORMAT: bool, const HEAVY: bool>(
    text: &[u16],
    start: usize,
    out: &mut [u8],
    mask_byte: u8,
    table: &[u16],
    high: &[u32],
    check_coverage: bool,
) -> u32 {
    let mask = u32::from(mask_byte) * 0x01010101;
    let mut state = Bits::default();
    let mut pos = start;
    while pos + 8 <= text.len() && state.at + 16 <= out.len() {
        for lane in 0..4 {
            if let Err(error) =
                full::<FORMAT, HEAVY>(text, pos + 2 * lane, out, table, high, &mut state, mask)
            {
                return error;
            }
        }
        pos += 8;
    }
    while pos < text.len() {
        let at = state.at;
        let word = match pair::<FORMAT, HEAVY>(text, pos, table, high, &mut state) {
            Ok(word) => word ^ mask,
            Err(error) => return error,
        };
        if at + 4 <= out.len() {
            // SAFETY: this tail store has its own complete-word bounds check.
            unsafe {
                core::ptr::write_unaligned(out.as_mut_ptr().add(at).cast::<u32>(), word.to_le());
            }
            state.covered = at + 4;
        } else {
            for (i, b) in word.to_le_bytes().into_iter().enumerate() {
                if let Some(byte) = out.get_mut(at + i) {
                    *byte = b;
                    state.covered = at + i + 1;
                }
            }
        }
        pos += 2;
    }
    if (FORMAT || check_coverage) && state.at < out.len() {
        return super::LENGTH;
    }
    if FORMAT {
        let remaining = out.len() as i64 - state.at as i64 + state.last_width as i64;
        if text.len() > start && remaining <= 0 {
            return super::LENGTH;
        }
        if state.carry != 0
            || (remaining < 4 && (state.last_word.wrapping_shr((8 * remaining) as u32)) != 0)
        {
            return super::PADDING;
        }
    }
    // Reused arenas must match a fresh JS Uint8Array even for unchecked packets
    // with incomplete decoded coverage. Zero only bytes no store actually wrote.
    if state.covered < out.len() {
        out[state.covered..].fill(0);
    }
    0
}
