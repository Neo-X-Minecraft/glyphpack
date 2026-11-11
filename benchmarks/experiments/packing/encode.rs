//! 0BSD, NeoX. Native-only reference encoders for the packing experiment.
use super::core;
pub fn pack_wide(data: &[u8], mask: u8, kind: u8, method: u32) -> Vec<u16> {
    let radix = 63484u64;
    let mut out = vec![
        (u32::from(mask) | (u32::from(kind) << 8) | (method << 10)) as u16,
        (data.len() as u64 % radix) as u16,
        (data.len() as u64 / radix) as u16,
    ];
    let word = method >= 8;
    let lower = if method == 9 {
        1u64 << 31
    } else if word {
        1u64 << 16
    } else {
        1u64 << 15
    };
    let bits = if word { 16 } else { 8 };
    let count = if word {
        data.len().div_ceil(2)
    } else {
        data.len()
    };
    let limit = (lower / (1u64 << bits)) * radix;
    let mut states = [lower; 4];
    let mut reversed = Vec::new();
    // rANS is a stack: consume symbols backwards, then reverse emitted digits.
    // Separate states keep the forward decoder's dependency chains independent.
    for i in (0..count).rev() {
        let symbol = if word {
            u64::from(data[i * 2] ^ mask)
                | (data.get(i * 2 + 1).map_or(0, |b| u64::from(b ^ mask)) << 8)
        } else {
            u64::from(data[i] ^ mask)
        };
        let x = &mut states[i % 4];
        while *x >= limit {
            reversed.push((*x % radix) as u16);
            *x /= radix;
        }
        *x = (*x << bits) | symbol;
        assert!(*x >= lower && *x < lower * radix);
    }
    // A 16-bit-symbol state can exceed radix² even in the low-precision mode.
    // Both word variants therefore require THREE state digits, including zero
    // and FF corpora whose final states expose a two-digit truncation bug.
    for mut x in states {
        for _ in 0..if method >= 8 { 3 } else { 2 } {
            out.push((x % radix) as u16);
            x /= radix;
        }
        assert_eq!(x, 0)
    }
    out.extend(reversed.into_iter().rev());
    out
}
pub fn header(out: &mut Vec<u8>, size: usize, mask: u8, kind: u8, method: u32, radix: u32) {
    let mut settings = u32::from(mask) | (u32::from(kind) << 8) | (method << 10);
    for _ in 0..2 {
        out.push((settings % radix) as u8);
        settings /= radix;
    }
    assert_eq!(settings, 0);
    let mut length = size;
    for _ in 0..4 {
        out.push((length % radix as usize) as u8);
        length /= radix as usize;
    }
    assert_eq!(length, 0);
}
pub fn pack(data: &[u8], mask: u8, kind: u8, method: u32, radix: u32) -> Vec<u8> {
    let mut out = Vec::new();
    header(&mut out, data.len(), mask, kind, method, radix);
    match method {
        0..=3 => group(data, mask, radix, [2, 4, 6, 8][method as usize], &mut out),
        4 => blocks(data, mask, &mut out),
        5 | 6 => ans(data, mask, radix, if method == 5 { 1 } else { 4 }, &mut out),
        _ => panic!("unknown method"),
    }
    out
}
fn group(data: &[u8], mask: u8, radix: u32, k: usize, out: &mut Vec<u8>) {
    let b = (k * 8) as u32;
    let cap = (0..k).fold(1u128, |v, _| v * u128::from(radix));
    let threshold = cap - (1u128 << (b - 1)) - 1;
    let (mut q, mut bits) = (0u128, 0u32);
    let emit = |out: &mut Vec<u8>, mut v: u128| {
        for _ in 0..k {
            out.push((v % u128::from(radix)) as u8);
            v /= u128::from(radix);
        }
        assert_eq!(v, 0);
    };
    for chunk in data.chunks(4) {
        let word = chunk
            .iter()
            .enumerate()
            .fold(0u128, |v, (i, b)| v | (u128::from(b ^ mask) << (i * 8)));
        q |= word << bits;
        bits += (chunk.len() * 8) as u32;
        while bits >= b {
            let width = if q & ((1u128 << (b - 1)) - 1) > threshold {
                b - 1
            } else {
                b
            };
            emit(out, q & ((1u128 << width) - 1));
            q >>= width;
            bits -= width;
        }
    }
    if bits > 0 {
        emit(out, q);
    }
}
fn blocks(data: &[u8], mask: u8, out: &mut Vec<u8>) {
    for bit in (0..data.len() * 8).step_by(703) {
        let mut limbs = [0u32; 22];
        for (i, limb) in limbs.iter_mut().enumerate() {
            let start = bit + i * 32;
            if start >= data.len() * 8 {
                break;
            }
            let n = (data.len() * 8 - start).min(if i == 21 { 31 } else { 32 });
            let mut word = 0u64;
            for j in 0..5 {
                if let Some(&b) = data.get(start / 8 + j) {
                    word |= u64::from(b ^ mask) << (j * 8);
                }
            }
            *limb = ((word >> (start % 8)) & ((1u64 << n) - 1)) as u32;
        }
        for _ in 0..88 {
            let mut rem = 0u64;
            for limb in limbs.iter_mut().rev() {
                let v = (rem << 32) | u64::from(*limb);
                *limb = (v / 254) as u32;
                rem = v % 254;
            }
            out.push(rem as u8);
        }
        assert!(limbs.iter().all(|&v| v == 0));
    }
}
fn ans(data: &[u8], mask: u8, radix: u32, lanes: usize, out: &mut Vec<u8>) {
    let limit = (core::STATE_L / 256) * radix;
    let mut states = [core::STATE_L; 4];
    let mut reversed = Vec::with_capacity(data.len() + data.len() / 100 + 16);
    // A uniform 256-symbol model is used solely for radix conversion. The
    // normalization limit ensures all states remain in [L,radix*L), so the
    // byte decoder needs only 32-bit arithmetic, without a BigInt queue.
    for i in (0..data.len()).rev() {
        let x = &mut states[i % lanes];
        while *x >= limit {
            reversed.push((*x % radix) as u8);
            *x /= radix;
        }
        *x = (*x << 8) | u32::from(data[i] ^ mask);
        assert!(*x >= core::STATE_L && *x < radix * core::STATE_L);
    }
    for &state in &states[..lanes] {
        let mut x = state;
        for _ in 0..4 {
            out.push((x % radix) as u8);
            x /= radix;
        }
        assert_eq!(x, 0);
    }
    out.extend(reversed.into_iter().rev());
}
