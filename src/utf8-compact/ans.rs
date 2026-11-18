//! 0BSD, NeoX. UTF-8 by a finite-state rANS channel, without large integers.
//! Q=2^23 probabilities approximate the capacity-achieving 1/2/3-byte alphabet.
//! L=2^30 keeps normalization loss below the measured source-size difference.
const DIGITS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const Q: u64 = 1 << 23;
const L: u64 = 1 << 30;
/// Write a packet using HTML-preserved Unicode scalars. The scalar gaps and
/// reversible script guards preserve exact text in an inert HTML data block.
pub fn encode(data: &[u8], mask: Option<u8>) -> Result<String, String> {
    if data.len() > 0x40000000 {
        return Err("Payload too large".into());
    }
    let mask = mask.unwrap_or(0);
    let mut x = L;
    let mut at = 0;
    let mut body = String::with_capacity(data.len() + data.len() / 8);
    while at < data.len() {
        let slot = x & (Q - 1);
        let (d, f, c, w) = if slot < 6470310 {
            (slot / 58821, 58821, 0, 1)
        } else if slot < 7411430 {
            ((slot - 6470310) / 58820, 58820, 6470310, 1)
        } else if slot < 8204390 {
            ((slot - 7411430) / 413, 413, 7411430, 2)
        } else {
            ((slot - 8204390) / 3, 3, 8204390, 3)
        };
        let digit = d as u32 + if c == 6470310 { 110 } else { 0 };
        body.push(super::point(digit, w));
        x = f * (x >> 23) + slot - c - d * f;
        while x < L && at < data.len() {
            x = (x << 8) | u64::from(data[at] ^ mask);
            at += 1;
        }
    }
    let mut out = String::with_capacity(body.len() + 24);
    out.push_str("~c2");
    out.push(DIGITS[(mask & 63) as usize] as char);
    out.push(DIGITS[(mask >> 6) as usize] as char);
    let mut n = data.len();
    loop {
        out.push(DIGITS[(n & 31) | if n >= 32 { 32 } else { 0 }] as char);
        n >>= 5;
        if n == 0 {
            break;
        }
    }
    // Seven little-endian base64 digits store the complete 38-bit terminal state.
    // The last two unused high bits are always zero; this bound is mandatory.
    for _ in 0..7 {
        out.push(DIGITS[(x & 63) as usize] as char);
        x >>= 6;
    }
    out.push_str(&super::protect(&body));
    Ok(out)
}
