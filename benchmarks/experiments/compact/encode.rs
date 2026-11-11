//! 0BSD, NeoX. Native reference encoder. All candidates use the exact production
//! alphabet, the same stored message/digest and the same selected XOR mask.
use glyphpack::encoder::alphabet;
pub fn packet(data: &[u8], mask: u8, kind: u8, profile: u32) -> Vec<u16> {
    let a = alphabet();
    let r = a.len() as u64;
    let lanes = match profile {
        0 | 4 => 4,
        1 => 1,
        2 => 2,
        3 => 8,
        _ => panic!("profile"),
    };
    let lower = if profile == 4 { 1u64 << 16 } else { 1u64 << 31 };
    let limit = (lower >> 16) * r;
    let mut states = vec![lower; lanes];
    let mut emitted = Vec::with_capacity(data.len() / 2 + 32);
    for i in (0..data.len().div_ceil(2)).rev() {
        let symbol = u64::from(data[2 * i] ^ mask)
            | (data.get(2 * i + 1).map_or(0, |b| u64::from(b ^ mask)) << 8);
        let x = &mut states[i % lanes];
        while *x >= limit {
            emitted.push((*x % r) as usize);
            *x /= r;
        }
        *x = (*x << 16) | symbol;
        assert!(*x >= lower && *x < lower * r);
    }
    // Reserved format-3 header space makes the alternative explicit. The
    // compact-only and combined kernels reject unselected profile bands.
    let settings = u32::from(mask) | (u32::from(kind) << 8);
    let mut digits = vec![
        33792 + profile as usize * 1024 + settings as usize,
        data.len() % a.len(),
        data.len() / a.len(),
    ];
    for mut x in states {
        for _ in 0..3 {
            digits.push((x % r) as usize);
            x /= r;
        }
        assert_eq!(x, 0);
    }
    digits.extend(emitted.into_iter().rev());
    digits.into_iter().map(|d| a[d]).collect()
}
