// 0BSD, NeoX. Independent finite-state and prefix-code experiments.
const C: [u32; 4] = [126, 1920, 61406, 1048544];
const SHORT: [u32; 4] = [110, 96, 34, 32];
const LEN: [u32; 8] = [7, 8, 14, 15, 21, 22, 28, 29];
const BASE: [u32; 8] = [0, 220, 15104, 30400, 2062336, 4124740, 267911168, 535822400];
fn point(d: u32, w: usize) -> char {
    let c = match w {
        0 => d + 1 + u32::from(d >= 12),
        1 => d + 128,
        2 => {
            let mut v = d + 2048;
            if v >= 0xd800 {
                v += 2048;
            }
            if v >= 0xfdd0 {
                v += 32;
            }
            v
        }
        _ => ((d / 65534 + 1) << 16) + (d % 65534),
    };
    char::from_u32(c).unwrap()
}
pub fn prefix(data: &[u8]) -> String {
    let mut out = String::new();
    let mut queue = 0u64;
    let mut bits = 0u32;
    let mut at = 0;
    let mut used = 0usize;
    while used < data.len() * 8 {
        while bits < 29 {
            queue = (queue << 8) | u64::from(data.get(at).copied().unwrap_or(0));
            bits += 8;
            at += 1;
        }
        let peek = (queue >> (bits - 29)) as u32;
        for k in 0..8 {
            let code = peek >> (29 - LEN[k]);
            let count = if k % 2 == 0 {
                SHORT[k / 2]
            } else {
                C[k / 2] - SHORT[k / 2]
            };
            if code >= BASE[k] && code < BASE[k] + count {
                let d = code - BASE[k] + if k % 2 == 0 { 0 } else { SHORT[k / 2] };
                out.push(point(d, k / 2));
                bits -= LEN[k];
                used += LEN[k] as usize;
                queue &= (1u64 << bits) - 1;
                break;
            }
        }
    }
    out
}
// Q=2^23; frequencies chosen near the capacity-achieving UTF-8 probabilities.
// Only 1/2/3-byte scalars: no supplementary-pair staging is needed.
const Q: u64 = 1 << 23;
pub fn ans(data: &[u8], shift: u32) -> (String, u64) {
    let groups = [
        (110u64, 58821u64, 0u32, 0usize),
        (16, 58820, 110, 0),
        (1920, 413, 0, 1),
        (61406, 3, 0, 2),
    ];
    let mut state = 1u64 << shift;
    let mut at = 0;
    let mut out = String::new();
    while at < data.len() {
        let slot = state & (Q - 1);
        let mut cdf = 0;
        let mut found = false;
        for (count, freq, offset, width) in groups {
            let end = cdf + count * freq;
            if slot < end {
                let d = (slot - cdf) / freq;
                out.push(point(d as u32 + offset, width));
                state = freq * (state >> 23) + (slot - cdf) % freq;
                found = true;
                break;
            }
            cdf = end;
        }
        assert!(found);
        while state < (1u64 << shift) && at < data.len() {
            state = (state << 8) | u64::from(data[at]);
            at += 1;
        }
    }
    (out, state)
}
