//! Format-3 encoding and exact adaptive XOR selection. No HTML or compression.
use crate::hash::{blake3, xxhash32};
use std::sync::OnceLock;

#[cfg(not(target_family = "wasm"))]
#[path = "encoder/parallel.rs"]
mod parallel;

pub const FORMAT_VERSION: u8 = 3;
pub const RADIX: u64 = 63385;
pub const THRESHOLD: u64 = RADIX * RADIX - 2147483649;
static ALPHABET: OnceLock<Vec<u16>> = OnceLock::new();

/// Ordered BMP alphabet shared with the JS table; excludes HTML '<', controls,
/// surrogates, noncharacters, BOM, and JS line/paragraph separators.
pub fn alphabet() -> &'static [u16] {
    ALPHABET.get_or_init(|| {
        (32u32..65534)
            .filter(|&c| {
                !(c == 60
                    || (127..=159).contains(&c)
                    || (55296..=57343).contains(&c)
                    || (64976..=65007).contains(&c)
                    || [65279, 8232, 8233].contains(&c))
            })
            .map(|c| c as u16)
            .collect()
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Integrity {
    None,
    Fast,
    Secure,
}
impl Integrity {
    pub fn kind(self) -> u16 {
        match self {
            Self::None => 0,
            Self::Fast => 1,
            Self::Secure => 2,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Fast => "fast",
            Self::Secure => "secure",
        }
    }
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "none" => Ok(Self::None),
            "fast" => Ok(Self::Fast),
            "secure" => Ok(Self::Secure),
            _ => Err("checksum must be none, fast or secure".into()),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Effort {
    Full,
    Fast,
}
#[derive(Clone, Debug)]
pub struct EncodeOptions {
    pub integrity: Integrity,
    pub mask: Option<u8>,
    pub effort: Effort,
    pub legacy: bool,
}
impl Default for EncodeOptions {
    fn default() -> Self {
        Self {
            integrity: Integrity::Secure,
            mask: None,
            effort: Effort::Full,
            legacy: false,
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct MaskSelection {
    pub mask: u8,
    pub pairs: usize,
    pub baseline_pairs: usize,
    pub candidates: usize,
}

// Treat the message and its small digest as one bitstream without copying the
// message. The third slice is used by sampled ranking (prefix, suffix, digest).
// Queue state spans slice boundaries, including boundaries inside a word.
struct Input<'a> {
    parts: [&'a [u8]; 3],
    len: usize,
}
impl<'a> Input<'a> {
    fn new(data: &'a [u8], trailer: &'a [u8]) -> Self {
        Self {
            parts: [data, trailer, &[]],
            len: data.len() + trailer.len(),
        }
    }
    fn sample(&self) -> Self {
        debug_assert!(self.len > 32768 && self.parts[2].is_empty());
        // All callers have at most a 32-byte trailer, so both sample windows
        // start in the original message. Their concatenation exactly matches
        // copying the first/last 16 KiB of the complete stored input.
        Self {
            parts: [
                &self.parts[0][..16384],
                &self.parts[0][self.len - 16384..],
                self.parts[1],
            ],
            len: 32768,
        }
    }
}

/// Count body pairs without allocating translated copies. Appending an input
/// word needs at most 63 bits; draining leaves at most 31 pending bits.
pub fn count_pairs(data: &[u8], mask: u8) -> usize {
    count_pairs_in(&Input::new(data, &[]), mask)
}

fn count_pairs_in(input: &Input<'_>, mask: u8) -> usize {
    let (mut queue, mut bits, mut count) = (0u64, 0u32, 0usize);
    let xor_word = u32::from(mask) * 0x01010101;
    for data in input.parts {
        for part in data.chunks(4) {
            // Four input bytes become one LE load and one word-wide XOR. Only the
            // final short part needs byte assembly; no unaligned/unsafe loads.
            let word = if let Ok(bytes) = <[u8; 4]>::try_from(part) {
                u64::from(u32::from_le_bytes(bytes) ^ xor_word)
            } else {
                part.iter()
                    .enumerate()
                    .fold(0u64, |v, (i, &b)| v | (u64::from(b ^ mask) << (8 * i)))
            };
            queue |= word << bits;
            bits += (part.len() * 8) as u32;
            while bits >= 32 {
                let width = if queue & 0x7fffffff > THRESHOLD {
                    31
                } else {
                    32
                };
                queue >>= width;
                bits -= width;
                count += 1;
            }
        }
    }
    count + usize::from(bits != 0)
}

// Count one complete input word with a 32-bit carry. Normally this emits one
// pair and retains 0..31 bits. At the rare 31->32-bit transition, the previous
// carry forms one narrow pair and the new word forms a second pair.
#[inline(always)]
fn score_word(carry: &mut u32, bits: &mut u32, count: &mut usize, word: u32) {
    let value = *carry | (word << *bits);
    let next = *bits + u32::from(u64::from(value & 0x7fffffff) > THRESHOLD);
    if next < 32 {
        *carry = if next == 0 { 0 } else { word >> (32 - next) };
        *bits = next;
        *count += 1;
    } else {
        debug_assert_eq!(next, 32);
        let reduced = u64::from(word & 0x7fffffff) > THRESHOLD;
        *carry = if reduced { word >> 31 } else { 0 };
        *bits = u32::from(reduced);
        *count += 2;
    }
}

// Four independent carry chains share each load. Mask order, exact scores and
// deterministic ties are unchanged. Short slice tails use the general queue;
// subsequent slices continue from exactly that carry state.
fn score_four(input: &Input<'_>, masks: [u8; 4]) -> [usize; 4] {
    let mut queues = [0u32; 4];
    let mut bits = [0u32; 4];
    let mut counts = [0usize; 4];
    let masks = masks.map(|m| u32::from(m) * 0x01010101);
    for data in input.parts {
        for part in data.chunks(4) {
            if let Ok(bytes) = <[u8; 4]>::try_from(part) {
                let word = u32::from_le_bytes(bytes);
                for lane in 0..4 {
                    score_word(
                        &mut queues[lane],
                        &mut bits[lane],
                        &mut counts[lane],
                        word ^ masks[lane],
                    );
                }
            } else {
                for lane in 0..4 {
                    let word = part.iter().enumerate().fold(0u64, |v, (i, &b)| {
                        v | (u64::from(b ^ masks[lane] as u8) << (8 * i))
                    });
                    let mut queue = u64::from(queues[lane]) | word << bits[lane];
                    bits[lane] += (part.len() * 8) as u32;
                    while bits[lane] >= 32 {
                        let width = if queue & 0x7fffffff > THRESHOLD {
                            31
                        } else {
                            32
                        };
                        queue >>= width;
                        bits[lane] -= width;
                        counts[lane] += 1;
                    }
                    queues[lane] = queue as u32;
                }
            }
        }
    }
    for i in 0..4 {
        counts[i] += usize::from(bits[i] != 0);
    }
    counts
}

const PRIORITY: [u8; 7] = [255, 85, 170, 51, 204, 15, 240];
// Stable priority is part of deterministic encoder output. Construct it once at
// compile time rather than allocating and filtering 255 masks on every call.
const MASKS: [u8; 255] = {
    let mut out = [0; 255];
    let mut i = 0;
    while i < PRIORITY.len() {
        out[i] = PRIORITY[i];
        i += 1;
    }
    let mut mask = 1;
    while mask < 256 {
        let mut k = 0;
        let mut priority = false;
        while k < PRIORITY.len() {
            priority |= mask as u8 == PRIORITY[k];
            k += 1;
        }
        if !priority {
            out[i] = mask as u8;
            i += 1;
        }
        mask += 1;
    }
    out
};

// Keep the ranking scratch off the exact/small-input call stack. The original
// priority index makes every key unique: unstable selection + sorting eight
// keys is equivalent to the former stable sort of all 255 scores, without heap
// allocation or a full O(n log n) sort.
#[inline(never)]
fn shortlist(input: &Input<'_>) -> [u8; 8] {
    let mut ranked = [(0usize, 0u8); 255];
    for (batch, masks) in MASKS.chunks(4).enumerate() {
        let counts = if let Ok(group) = <[u8; 4]>::try_from(masks) {
            score_four(input, group)
        } else {
            let mut counts = [0; 4];
            for (i, &mask) in masks.iter().enumerate() {
                counts[i] = count_pairs_in(input, mask);
            }
            counts
        };
        for (lane, &count) in counts.iter().take(masks.len()).enumerate() {
            let index = batch * 4 + lane;
            ranked[index] = (count, index as u8);
        }
    }
    ranked.select_nth_unstable(8);
    ranked[..8].sort_unstable();
    std::array::from_fn(|i| MASKS[ranked[i].1 as usize])
}

/// Full search is exact; sampled fast search retains identity on ties and never
/// enlarges its body. Header width is independent of the selected byte mask.
pub fn choose_mask(data: &[u8], effort: Effort) -> MaskSelection {
    choose_mask_in(&Input::new(data, &[]), effort)
}

fn consider(best: &mut MaskSelection, mask: u8, count: usize, minimum: usize) -> bool {
    best.candidates += 1;
    if count < best.pairs {
        best.mask = mask;
        best.pairs = count;
    }
    best.pairs == minimum
}

fn choose_mask_in(input: &Input<'_>, effort: Effort) -> MaskSelection {
    let baseline = count_pairs_in(input, 0);
    let mut best = MaskSelection {
        mask: 0,
        pairs: baseline,
        baseline_pairs: baseline,
        candidates: 1,
    };
    let minimum = input.len.div_ceil(4);
    if best.pairs == minimum {
        return best;
    }
    let sampled = effort == Effort::Fast && input.len > 32768;
    let selected;
    let masks: &[u8] = if sampled {
        selected = shortlist(&input.sample());
        &selected
    } else {
        &MASKS
    };
    // Preserve cheap early exits for common low-entropy inputs. The sampled
    // shortlist already ranks the strongest candidate first.
    let early = if sampled { 1 } else { PRIORITY.len() }.min(masks.len());
    for &mask in &masks[..early] {
        if consider(&mut best, mask, count_pairs_in(input, mask), minimum) {
            return best;
        }
    }
    #[cfg(not(target_family = "wasm"))]
    if !sampled {
        if let Some(counts) = parallel::scores(input, &masks[early..], best.pairs) {
            for (&mask, count) in masks[early..].iter().zip(counts) {
                if consider(&mut best, mask, count, minimum) {
                    return best;
                }
            }
            return best;
        }
    }
    for chunk in masks[early..].chunks(4) {
        let counts = if let Ok(group) = <[u8; 4]>::try_from(chunk) {
            score_four(input, group)
        } else {
            let mut counts = [0; 4];
            for (i, &mask) in chunk.iter().enumerate() {
                counts[i] = count_pairs_in(input, mask);
            }
            counts
        };
        for (&mask, count) in chunk.iter().zip(counts) {
            // candidates counts results considered in order; later parallel
            // results can be discarded after the exact minimum is reached.
            if consider(&mut best, mask, count, minimum) {
                return best;
            }
        }
    }
    best
}

// Output backends are monomorphized, so the packing loop contains no runtime
// format dispatcher. Byte output writes a whole symbol pair with one LE store;
// UTF-8 text and u16 callers never build an intermediate representation.
trait Output {
    fn reset(&mut self, units: usize);
    fn unit(&mut self, unit: u16);
    fn pair(&mut self, low: u16, high: u16) {
        self.unit(low);
        self.unit(high);
    }
}
struct Units<'a>(&'a mut Vec<u16>);
impl Output for Units<'_> {
    fn reset(&mut self, n: usize) {
        self.0.clear();
        self.0.reserve(n);
    }
    fn unit(&mut self, c: u16) {
        self.0.push(c);
    }
    fn pair(&mut self, low: u16, high: u16) {
        self.0.extend_from_slice(&[low, high]);
    }
}
struct LittleEndian<'a>(&'a mut Vec<u8>);
impl Output for LittleEndian<'_> {
    fn reset(&mut self, n: usize) {
        self.0.clear();
        self.0.reserve(n * 2);
    }
    fn unit(&mut self, c: u16) {
        self.0.extend_from_slice(&c.to_le_bytes());
    }
    fn pair(&mut self, low: u16, high: u16) {
        self.0
            .extend_from_slice(&(u32::from(low) | (u32::from(high) << 16)).to_le_bytes());
    }
}
struct Text<'a>(&'a mut String);
impl Output for Text<'_> {
    fn reset(&mut self, n: usize) {
        self.0.clear();
        self.0.reserve(n * 3);
    }
    fn unit(&mut self, c: u16) {
        self.0.push(char::from_u32(u32::from(c)).unwrap());
    }
}

fn encode<O: Output>(data: &[u8], options: &EncodeOptions, out: &mut O) -> Result<(), String> {
    if options.legacy
        && (options.integrity != Integrity::None || options.mask.is_some_and(|m| m != 0))
    {
        return Err("Legacy packets do not support masks or checksums".into());
    }
    let trailer = match options.integrity {
        Integrity::None => 0,
        Integrity::Fast => 4,
        Integrity::Secure => 32,
    };
    let length = data.len().checked_add(trailer).ok_or("Payload too large")?;
    if length as u64 >= RADIX * RADIX {
        return Err("Payload too large".into());
    }
    // Hash original bytes and append the trailer virtually. Both mask search
    // and packing carry queue state across slices; no message-sized temporary
    // or copied 32 KiB sample is required in any verification mode.
    let mut digest = [0; 32];
    match options.integrity {
        Integrity::Fast => digest[..4].copy_from_slice(&xxhash32(data).to_le_bytes()),
        Integrity::Secure => digest = blake3(data),
        Integrity::None => {}
    }
    let stored = Input::new(data, &digest[..trailer]);
    // Reuse the exact pair count already obtained by automatic mask search.
    // Explicit masks reserve a conservative 31-bit bound instead of adding an
    // entire counting pass. Both strategies avoid output-buffer growth/copies.
    let (mask, pairs) = if options.legacy {
        (0, (length as u64 * 8).div_ceil(31) as usize)
    } else if let Some(mask) = options.mask {
        (mask, (length as u64 * 8).div_ceil(31) as usize)
    } else {
        let choice = choose_mask_in(&stored, options.effort);
        (choice.mask, choice.pairs)
    };
    let mode = u16::from(mask) | (options.integrity.kind() << 8);
    let n = length as u64;
    let a = alphabet();
    debug_assert_eq!(a.len() as u64, RADIX);
    out.reset(pairs * 2 + 3);
    if options.legacy {
        out.pair(a[(n % RADIX) as usize], a[(n / RADIX) as usize]);
    } else if n < 32 * RADIX {
        out.pair(
            a[mode as usize + 1024 * (n / RADIX) as usize],
            a[(n % RADIX) as usize],
        );
    } else {
        out.unit(a[32768 + mode as usize]);
        out.pair(a[(n % RADIX) as usize], a[(n / RADIX) as usize]);
    }
    let xor_word = u32::from(mask) * 0x01010101;
    let (mut queue, mut bits) = (0u64, 0u32);
    for data in stored.parts {
        for part in data.chunks(4) {
            let word = if let Ok(bytes) = <[u8; 4]>::try_from(part) {
                u64::from(u32::from_le_bytes(bytes) ^ xor_word)
            } else {
                part.iter()
                    .enumerate()
                    .fold(0u64, |v, (i, &b)| v | (u64::from(b ^ mask) << (8 * i)))
            };
            queue |= word << bits;
            bits += (part.len() * 8) as u32;
            while bits >= 32 {
                let narrow = queue & 0x7fffffff > THRESHOLD;
                // Packed values always fit in u32. Keeping constant division at
                // that width avoids a wider quotient sequence, especially in Wasm.
                let value = (queue & if narrow { 0x7fffffff } else { 0xffffffff }) as u32;
                let width = if narrow { 31 } else { 32 };
                out.pair(
                    a[(value % RADIX as u32) as usize],
                    a[(value / RADIX as u32) as usize],
                );
                queue >>= width;
                bits -= width;
            }
        }
    }
    if bits != 0 {
        let value = queue as u32;
        out.pair(
            a[(value % RADIX as u32) as usize],
            a[(value / RADIX as u32) as usize],
        );
    }
    Ok(())
}

/// Format-3 UTF-16 code units, without a document BOM. Hash original bytes,
/// append the optional trailer, XOR actual bytes, and zero-pad only the final
/// packed pair. The header length always includes the trailer.
pub fn encode_units(data: &[u8], options: &EncodeOptions) -> Result<Vec<u16>, String> {
    let mut out = Vec::new();
    encode_units_into(data, options, &mut out)?;
    Ok(out)
}
/// UTF-8 Rust string for callers doing their own document/text serialization.
pub fn encode_text(data: &[u8], options: &EncodeOptions) -> Result<String, String> {
    let mut out = String::new();
    encode_text_into(data, options, &mut out)?;
    Ok(out)
}
/// Direct UTF-16LE bytes, without an intermediate u16 buffer or document BOM.
pub fn dense16(data: &[u8], options: &EncodeOptions) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    dense16_into(data, options, &mut out)?;
    Ok(out)
}

/// Replace UTF-16 output while retaining its allocation. Validation errors
/// leave the previous contents intact. After warming the alphabet, serial
/// encoding needs no heap allocation when this capacity is already sufficient.
pub fn encode_units_into(
    data: &[u8],
    options: &EncodeOptions,
    out: &mut Vec<u16>,
) -> Result<(), String> {
    encode(data, options, &mut Units(out))
}
/// Replace UTF-16LE output, reusing capacity and preserving it on validation errors.
pub fn dense16_into(data: &[u8], options: &EncodeOptions, out: &mut Vec<u8>) -> Result<(), String> {
    encode(data, options, &mut LittleEndian(out))
}
/// Replace UTF-8 output, reusing capacity and preserving it on validation errors.
pub fn encode_text_into(
    data: &[u8],
    options: &EncodeOptions,
    out: &mut String,
) -> Result<(), String> {
    encode(data, options, &mut Text(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn segmented_queues_match_concatenated_bytes() {
        let mut seed = 917u32;
        for len in (0usize..40).chain([63, 65, 127, 4095, 32769]) {
            let data: Vec<_> = (0..len)
                .map(|_| {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    (seed >> 24) as u8
                })
                .collect();
            for a in [0, 1.min(len), len / 3, len / 2, len] {
                for b in [a, (a + 3).min(len), len.saturating_sub(1).max(a), len] {
                    let input = Input {
                        parts: [&data[..a], &data[a..b], &data[b..]],
                        len,
                    };
                    for masks in [[0, 1, 2, 3], [85, 170, 15, 240], [252, 253, 254, 255]] {
                        assert_eq!(
                            score_four(&input, masks),
                            masks.map(|m| count_pairs(&data, m)),
                            "{len}, {a}, {b}"
                        );
                    }
                }
            }
        }
    }
    #[test]
    fn virtual_digest_samples_match_copied_windows() {
        for len in [32737, 32765, 32768, 32769, 65537] {
            let data: Vec<_> = (0..len).map(|i| i as u8).collect();
            for trailer in [&[0u8; 32][..0], &[0u8; 32][..4], &[0u8; 32][..32]] {
                let input = Input::new(&data, trailer);
                if input.len <= 32768 {
                    continue;
                }
                let joined = input.parts.concat();
                let expected = [&joined[..16384], &joined[joined.len() - 16384..]].concat();
                assert_eq!(input.sample().parts.concat(), expected);
            }
        }
    }
    #[test]
    fn reusable_outputs_keep_capacity_and_preserve_failed_results() {
        let options = EncodeOptions::default();
        let large: Vec<_> = (0..4097).map(|i| i as u8).collect();
        let mut units = encode_units(&large, &options).unwrap();
        let mut bytes = dense16(&large, &options).unwrap();
        let mut text = encode_text(&large, &options).unwrap();
        let pointers = (units.as_ptr(), bytes.as_ptr(), text.as_ptr());
        for data in [b"short".as_slice(), &[], &large[..63]] {
            encode_units_into(data, &options, &mut units).unwrap();
            dense16_into(data, &options, &mut bytes).unwrap();
            encode_text_into(data, &options, &mut text).unwrap();
            assert_eq!(units, encode_units(data, &options).unwrap());
            assert_eq!(bytes, dense16(data, &options).unwrap());
            assert_eq!(text, encode_text(data, &options).unwrap());
            assert_eq!(pointers, (units.as_ptr(), bytes.as_ptr(), text.as_ptr()));
        }
        let before = (units.clone(), bytes.clone(), text.clone());
        let bad = EncodeOptions {
            legacy: true,
            ..options
        };
        assert!(encode_units_into(b"bad", &bad, &mut units).is_err());
        assert!(dense16_into(b"bad", &bad, &mut bytes).is_err());
        assert!(encode_text_into(b"bad", &bad, &mut text).is_err());
        assert_eq!((units, bytes, text), before);
    }
    #[test]
    fn parallel_scores_match_scalar_for_every_mask_and_short_tail() {
        let mut seed = 833u32;
        for n in (0..40).chain([63, 64, 65, 257, 4097]) {
            let random: Vec<u8> = (0..n)
                .map(|_| {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    (seed >> 24) as u8
                })
                .collect();
            for data in [random, vec![255; n]] {
                for first in (0u8..=252).step_by(4) {
                    let masks = [first, first + 1, first + 2, first + 3];
                    assert_eq!(
                        score_four(&Input::new(&data, &[]), masks),
                        masks.map(|m| count_pairs(&data, m)),
                        "length {n}, masks {masks:?}"
                    );
                }
            }
        }
    }
    #[test]
    fn sampled_selection_preserves_scalar_ties_and_candidate_order() {
        let mut seed = 91u32;
        for n in [32768, 32769, 65537] {
            let data: Vec<u8> = (0..n)
                .map(|_| {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    (seed >> 24) as u8
                })
                .collect();
            // Scalar reference from before batched scoring. Stable priority is
            // part of deterministic encoder output, including equal scores.
            let priority = [255, 85, 170, 51, 204, 15, 240];
            let mut masks: Vec<u8> = priority
                .into_iter()
                .chain((1..=255).filter(|m| !priority.contains(m)))
                .collect();
            if n > 32768 {
                let mut sample = data[..16384].to_vec();
                sample.extend_from_slice(&data[n - 16384..]);
                masks.sort_by_cached_key(|&m| count_pairs(&sample, m));
                masks.truncate(8);
            }
            let baseline = count_pairs(&data, 0);
            let mut expected = (0, baseline, 1);
            if baseline != n.div_ceil(4) {
                for mask in masks {
                    let pairs = count_pairs(&data, mask);
                    expected.2 += 1;
                    if pairs < expected.1 {
                        expected.0 = mask;
                        expected.1 = pairs;
                    }
                    if pairs == n.div_ceil(4) {
                        break;
                    }
                }
            }
            let actual = choose_mask(&data, Effort::Fast);
            assert_eq!(
                (actual.mask, actual.pairs, actual.candidates),
                expected,
                "length {n}"
            );
            assert_eq!(actual.baseline_pairs, baseline);
        }
    }
}
