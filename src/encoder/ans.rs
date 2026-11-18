//! Four-state uniform ANS. The message/digest are borrowed as two slices; no
//! message-sized concatenation is made. Encoder output is reversed once because
//! ANS is a stack. Decoding remains forward, synchronous and allocation-bounded.
use super::{alphabet, EncodeOptions, Input, Output, Packing};
use crate::hash::{blake3, xxhash32};
use std::sync::OnceLock;
static WINDOWS: OnceLock<Vec<u16>> = OnceLock::new();
pub fn windows_alphabet() -> &'static [u16] {
    WINDOWS.get_or_init(|| {
        let a: Vec<u16> = (0..=255u8)
            .map(crate::packing::windows_code_point)
            .collect();
        a.into_iter()
            .enumerate()
            .filter(|(b, _)| *b != 13 && *b != 60)
            .map(|(_, c)| c)
            .collect()
    })
}
pub(super) fn encode<O: Output>(
    data: &[u8],
    options: &EncodeOptions,
    out: &mut O,
) -> Result<(), String> {
    let kind = options.integrity.kind();
    let trailer = [0, 4, 32][kind as usize];
    let n = data.len().checked_add(trailer).ok_or("Payload too large")?;
    let windows = options.packing == Packing::Windows;
    let a = if windows {
        windows_alphabet()
    } else {
        alphabet()
    };
    let r = a.len() as u64;
    if n as u64 >= r.pow(if windows { 4 } else { 2 }) {
        return Err("Payload too large".into());
    }
    let mut digest = [0; 32];
    match options.integrity {
        super::Integrity::Fast => digest[..4].copy_from_slice(&xxhash32(data).to_le_bytes()),
        super::Integrity::Secure => digest = blake3(data),
        _ => (),
    }
    let mask = options.mask.unwrap_or_else(|| {
        // Mask choice has negligible effect on the precise uniform model.
        // Preserve automatic masking without scanning all 256 complete ANS
        // streams: choose using the existing sampled/exact pair scorer.
        super::choose_mask_in(&Input::new(data, &digest[..trailer]), options.effort).mask
    });
    let get = |i: usize| {
        if i < data.len() {
            data[i]
        } else {
            digest[i - data.len()]
        }
    };
    let bits = if windows { 8 } else { 16 };
    let lower = if windows { 1u64 << 23 } else { 1u64 << 31 };
    let limit = (lower >> bits) * r;
    let mut states = [lower; 4];
    let mut body = Vec::with_capacity(if windows {
        n + n / 100 + 16
    } else {
        n / 2 + n / 100 + 16
    });
    let count = if windows { n } else { n.div_ceil(2) };
    for i in (0..count).rev() {
        let symbol = if windows {
            u64::from(get(i) ^ mask)
        } else {
            u64::from(get(i * 2) ^ mask)
                | (if i * 2 + 1 < n {
                    u64::from(get(i * 2 + 1) ^ mask) << 8
                } else {
                    0
                })
        };
        let x = &mut states[i % 4];
        while *x >= limit {
            body.push(a[(*x % r) as usize]);
            *x /= r;
        }
        *x = (*x << bits) | symbol;
    }
    let settings = u64::from(mask) | (u64::from(kind) << 8);
    out.reset(body.len() + 24);
    out.unit(options.packing.tag());
    if windows {
        out.unit(a[(settings % r) as usize]);
        out.unit(a[(settings / r) as usize]);
        let mut len = n as u64;
        for _ in 0..4 {
            out.unit(a[(len % r) as usize]);
            len /= r;
        }
    } else if (n as u64) < 32 * r {
        out.unit(a[(settings + 1024 * (n as u64 / r)) as usize]);
        out.unit(a[(n as u64 % r) as usize]);
    } else {
        out.unit(a[(32768 + settings) as usize]);
        out.unit(a[(n as u64 % r) as usize]);
        out.unit(a[(n as u64 / r) as usize]);
    }
    for mut state in states {
        for _ in 0..if windows { 4 } else { 3 } {
            out.unit(a[(state % r) as usize]);
            state /= r;
        }
    }
    for unit in body.into_iter().rev() {
        out.unit(unit)
    }
    Ok(())
}
