//! 0BSD, NeoX. Compact UTF-8 transport. New packets use finite-state rANS;
//! the previous 4 KiB enumerative encoder remains available for compatibility.
#[path = "utf8-compact/ans.rs"]
mod ans;
pub use ans::encode;
use std::{cmp::Ordering, sync::OnceLock};
const COUNTS: [u32; 4] = [126, 1920, 61406, 1048544];
const BLOCK: usize = 4096;
const DIGITS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Only operations needed for enumerative ranks: add/multiply by a small
/// digit, subtraction, comparison, and bounded small-quotient division.
#[derive(Clone, Default, Debug, Eq, PartialEq)]
struct Big(Vec<u32>);
impl Ord for Big {
    fn cmp(&self, b: &Self) -> Ordering {
        self.0
            .len()
            .cmp(&b.0.len())
            .then_with(|| self.0.iter().rev().cmp(b.0.iter().rev()))
    }
}
impl PartialOrd for Big {
    fn partial_cmp(&self, b: &Self) -> Option<Ordering> {
        Some(self.cmp(b))
    }
}
impl Big {
    fn trim(&mut self) {
        while self.0.last() == Some(&0) {
            self.0.pop();
        }
    }
    fn power(bits: usize) -> Self {
        let mut v = vec![0; bits / 32 + 1];
        v[bits / 32] = 1 << (bits % 32);
        Self(v)
    }
    fn bytes(input: &[u8], mask: u8) -> Self {
        let mut v = vec![0u32; input.len().div_ceil(4)];
        for (i, &b) in input.iter().rev().enumerate() {
            v[i / 4] |= u32::from(b ^ mask) << (8 * (i % 4));
        }
        let mut n = Self(v);
        n.trim();
        n
    }
    fn add_scaled(&mut self, b: &Self, m: u32) {
        if m == 0 {
            return;
        }
        self.0.resize(self.0.len().max(b.0.len()), 0);
        let mut carry = 0u64;
        for (i, &v) in b.0.iter().enumerate() {
            let x = u64::from(self.0[i]) + u64::from(v) * u64::from(m) + carry;
            self.0[i] = x as u32;
            carry = x >> 32;
        }
        let mut i = b.0.len();
        while carry != 0 {
            if i == self.0.len() {
                self.0.push(0);
            }
            let x = u64::from(self.0[i]) + carry;
            self.0[i] = x as u32;
            carry = x >> 32;
            i += 1;
        }
    }
    fn mul(&self, m: u32) -> Self {
        let mut n = Self::default();
        n.add_scaled(self, m);
        n
    }
    fn sub(&mut self, b: &Self) {
        debug_assert!(&*self >= b);
        let mut borrow = 0u64;
        for (i, v) in self.0.iter_mut().enumerate() {
            let rhs = u64::from(b.0.get(i).copied().unwrap_or(0)) + borrow;
            let old = u64::from(*v);
            *v = old.wrapping_sub(rhs) as u32;
            borrow = u64::from(old < rhs);
        }
        debug_assert_eq!(borrow, 0);
        self.trim();
    }
    fn top(&self) -> f64 {
        let n = self.0.len();
        f64::from(self.0[n - 1])
            + if n > 1 {
                f64::from(self.0[n - 2]) / 4294967296.0
            } else {
                0.0
            }
    }
    fn take_digit(&mut self, weight: &Self, count: u32) -> u32 {
        if &*self < weight {
            return 0;
        }
        // The quotient is at most 1,048,543. Floating point supplies an estimate;
        // exact integer comparisons and corrections determine the wire result.
        let scale = 2f64.powi(32 * (self.0.len() as i32 - weight.0.len() as i32));
        let mut q = ((self.top() / weight.top() * scale) as u32).min(count - 1);
        let mut product = weight.mul(q);
        while product > *self {
            q -= 1;
            product.sub(weight);
        }
        loop {
            let mut next = product.clone();
            next.add_scaled(weight, 1);
            if q + 1 == count || next > *self {
                break;
            }
            q += 1;
            product = next;
        }
        self.sub(&product);
        q
    }
}
struct Model {
    ways: Vec<Big>,
    lengths: Vec<usize>,
}
static MODEL: OnceLock<Model> = OnceLock::new();
fn model() -> &'static Model {
    MODEL.get_or_init(|| {
        let mut ways = vec![Big(vec![1])];
        let goal = Big::power(BLOCK * 8);
        while ways.last().unwrap() < &goal {
            let n = ways.len();
            let mut sum = Big::default();
            for w in 1..=4.min(n) {
                sum.add_scaled(&ways[n - w], COUNTS[w - 1]);
            }
            ways.push(sum);
        }
        let mut lengths = vec![0; BLOCK + 1];
        let mut at = 0;
        for (n, length) in lengths.iter_mut().enumerate().skip(1) {
            let goal = Big::power(n * 8);
            while ways[at] < goal {
                at += 1;
            }
            *length = at;
        }
        Model { ways, lengths }
    })
}
fn point(d: u32, w: usize) -> char {
    let cp = match w {
        1 => d + 1 + u32::from(d >= 12),
        2 => d + 128,
        3 => {
            let mut cp = d + 2048;
            if cp >= 0xd800 {
                cp += 2048;
            }
            if cp >= 0xfdd0 {
                cp += 32;
            }
            cp
        }
        _ => ((d / 65534 + 1) << 16) + (d % 65534),
    };
    char::from_u32(cp).unwrap()
}
fn body(data: &[u8], mask: u8) -> String {
    if data.is_empty() {
        return String::new();
    }
    let m = model();
    let mut out = String::with_capacity(data.len() + data.len() / 8 + 8);
    for block in data.chunks(BLOCK) {
        let mut rank = Big::bytes(block, mask);
        let mut left = m.lengths[block.len()];
        while left > 0 {
            let mut found = false;
            for w in 1..=4.min(left) {
                let weight = &m.ways[left - w];
                let capacity = weight.mul(COUNTS[w - 1]);
                if rank < capacity {
                    let d = rank.take_digit(weight, COUNTS[w - 1]);
                    out.push(point(d, w));
                    left -= w;
                    found = true;
                    break;
                }
                rank.sub(&capacity);
            }
            assert!(found);
        }
        debug_assert!(rank.0.is_empty());
    }
    out
}
/// Guard HTML script transitions and escape the naturally occurring guard
/// prefix too, making removal of one guard level bijective.
pub fn protect(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    for (i, c) in text.char_indices() {
        out.push(c);
        if c == '<' {
            let rest = &b[i + 1..];
            if rest.starts_with(b"!--")
                || rest.starts_with(&[1, 1, 1])
                || rest
                    .get(..6)
                    .is_some_and(|s| s.eq_ignore_ascii_case(b"script"))
                || rest
                    .get(..7)
                    .is_some_and(|s| s.eq_ignore_ascii_case(b"/script"))
            {
                out.push_str("\x01\x01\x01");
            }
        }
    }
    out
}
/// Raw compact packet. NUL, CR, surrogates and Unicode noncharacters are
/// excluded. Normalization/sanitization is outside this binary-text contract.
pub fn encode_enumerative(data: &[u8], mask: Option<u8>) -> Result<String, String> {
    if data.len() > 0x40000000 {
        return Err("Payload too large".into());
    }
    let first = mask.unwrap_or(0);
    let raw = body(data, first);
    let mut protected = protect(&raw);
    let mut chosen = first;
    // Byte cost before guarding is identical for every mask. Usually no guard
    // exists, which proves mask zero optimal; only a rare guard triggers retries.
    if mask.is_none() && protected.len() > raw.len() {
        for m in [255, 85] {
            let candidate = protect(&body(data, m));
            if candidate.len() < protected.len() {
                protected = candidate;
                chosen = m;
            }
            if protected.len() == raw.len() {
                break;
            }
        }
    }
    let mut out = String::with_capacity(protected.len() + 16);
    out.push_str("~c1");
    out.push(DIGITS[(chosen & 63) as usize] as char);
    out.push(DIGITS[(chosen >> 6) as usize] as char);
    let mut n = data.len();
    loop {
        out.push(DIGITS[(n & 31) | if n >= 32 { 32 } else { 0 }] as char);
        n >>= 5;
        if n == 0 {
            break;
        }
    }
    out.push_str(&protected);
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_quotient_and_carries() {
        for n in [
            0u128,
            1,
            0xffffffff,
            1 << 32,
            (1 << 80) + 0xfefefefe,
            (1 << 112) - 1,
        ] {
            let bytes = n.to_be_bytes();
            let weight = Big::bytes(&bytes, 0);
            if n == 0 {
                continue;
            }
            for q in [0, 1, 126, 65533, 1048543] {
                let mut rank = weight.mul(q);
                rank.add_scaled(&Big(vec![1]), 1);
                if n > 1 {
                    assert_eq!(rank.take_digit(&weight, 1048544), q);
                    assert_eq!(rank, Big(vec![1]));
                }
            }
        }
    }
    #[test]
    fn model_cost_and_alphabet() {
        assert_eq!(model().lengths[1], 2);
        for (w, &n) in COUNTS.iter().enumerate() {
            for d in 0..n {
                let c = point(d, w + 1);
                assert_eq!(c.len_utf8(), w + 1);
                let cp = c as u32;
                assert_ne!(cp, 0);
                assert_ne!(cp, 13);
                assert!(!(0xfdd0..=0xfdef).contains(&cp));
                assert!(cp & 65535 < 65534);
            }
        }
        assert_eq!(encode_enumerative(&[], None).unwrap(), "~c1AAA");
        assert!(encode(&[], None).unwrap().starts_with("~c2"));
    }
}
