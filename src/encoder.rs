//! Format-3 encoding and exact adaptive XOR selection. No HTML or compression.
use crate::hash::{blake3, xxhash32};
use std::{borrow::Cow, sync::OnceLock};

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

/// Count body pairs without allocating translated copies. Appending an input
/// word needs at most 63 bits; draining leaves at most 31 pending bits.
pub fn count_pairs(data: &[u8], mask: u8) -> usize {
    let (mut queue, mut bits, mut count) = (0u64, 0u32, 0usize);
    let xor_word = u32::from(mask) * 0x01010101;
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
    count + usize::from(bits != 0)
}

/// Full search is exact; sampled fast search retains identity on ties and never
/// enlarges its body. Header width is independent of the selected byte mask.
pub fn choose_mask(data: &[u8], effort: Effort) -> MaskSelection {
    let baseline = count_pairs(data, 0);
    let mut best = MaskSelection {
        mask: 0,
        pairs: baseline,
        baseline_pairs: baseline,
        candidates: 1,
    };
    let minimum = data.len().div_ceil(4);
    if best.pairs == minimum {
        return best;
    }
    let priority = [255, 85, 170, 51, 204, 15, 240];
    let mut masks: Vec<u8> = priority
        .into_iter()
        .chain((1..=255).filter(|m| !priority.contains(m)))
        .collect();
    if effort == Effort::Fast && data.len() > 32768 {
        let mut sample = data[..16384].to_vec();
        sample.extend_from_slice(&data[data.len() - 16384..]);
        // Cache each score once. sort_by_key would rescan the sample for every
        // comparison; this stable ordering also preserves identity/tie policy.
        masks.sort_by_cached_key(|&m| count_pairs(&sample, m));
        masks.truncate(8);
    }
    for mask in masks {
        let count = count_pairs(data, mask);
        best.candidates += 1;
        if count < best.pairs {
            best.mask = mask;
            best.pairs = count;
            if count == minimum {
                break;
            }
        }
    }
    best
}

// Output backends are monomorphized, so the packing loop contains no runtime
// format dispatcher. Byte output writes a whole symbol pair with one LE store;
// UTF-8 text and u16 callers never build an intermediate representation.
trait Output {
    type Buffer;
    fn reserve(units: usize) -> Self;
    fn unit(&mut self, unit: u16);
    fn pair(&mut self, low: u16, high: u16) {
        self.unit(low);
        self.unit(high);
    }
    fn finish(self) -> Self::Buffer;
}
struct Units(Vec<u16>);
impl Output for Units {
    type Buffer = Vec<u16>;
    fn reserve(n: usize) -> Self {
        Self(Vec::with_capacity(n))
    }
    fn unit(&mut self, c: u16) {
        self.0.push(c);
    }
    fn finish(self) -> Vec<u16> {
        self.0
    }
}
struct LittleEndian(Vec<u8>);
impl Output for LittleEndian {
    type Buffer = Vec<u8>;
    fn reserve(n: usize) -> Self {
        Self(Vec::with_capacity(n * 2))
    }
    fn unit(&mut self, c: u16) {
        self.0.extend_from_slice(&c.to_le_bytes());
    }
    fn pair(&mut self, low: u16, high: u16) {
        self.0
            .extend_from_slice(&(u32::from(low) | (u32::from(high) << 16)).to_le_bytes());
    }
    fn finish(self) -> Vec<u8> {
        self.0
    }
}
struct Text(String);
impl Output for Text {
    type Buffer = String;
    fn reserve(n: usize) -> Self {
        Self(String::with_capacity(n * 3))
    }
    fn unit(&mut self, c: u16) {
        self.0.push(char::from_u32(u32::from(c)).unwrap());
    }
    fn finish(self) -> String {
        self.0
    }
}

fn encode<O: Output>(data: &[u8], options: &EncodeOptions) -> Result<O::Buffer, String> {
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
    // No-checksum encoding borrows the caller's bytes. Protected packets copy
    // once into an exactly sized buffer to append their real digest.
    let stored: Cow<'_, [u8]> = if trailer == 0 {
        Cow::Borrowed(data)
    } else {
        let mut bytes = Vec::with_capacity(length);
        bytes.extend_from_slice(data);
        match options.integrity {
            Integrity::Fast => bytes.extend_from_slice(&xxhash32(data).to_le_bytes()),
            Integrity::Secure => bytes.extend_from_slice(&blake3(data)),
            _ => unreachable!(),
        }
        Cow::Owned(bytes)
    };
    // Reuse the exact pair count already obtained by automatic mask search.
    // Explicit masks reserve a conservative 31-bit bound instead of adding an
    // entire counting pass. Both strategies avoid output-buffer growth/copies.
    let (mask, pairs) = if options.legacy {
        (0, (length as u64 * 8).div_ceil(31) as usize)
    } else if let Some(mask) = options.mask {
        (mask, (length as u64 * 8).div_ceil(31) as usize)
    } else {
        let choice = choose_mask(&stored, options.effort);
        (choice.mask, choice.pairs)
    };
    let mode = u16::from(mask) | (options.integrity.kind() << 8);
    let n = length as u64;
    let a = alphabet();
    debug_assert_eq!(a.len() as u64, RADIX);
    let mut out = O::reserve(pairs * 2 + 3);
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
    for part in stored.chunks(4) {
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
            let value = queue & if narrow { 0x7fffffff } else { 0xffffffff };
            let width = if narrow { 31 } else { 32 };
            out.pair(a[(value % RADIX) as usize], a[(value / RADIX) as usize]);
            queue >>= width;
            bits -= width;
        }
    }
    if bits != 0 {
        out.pair(a[(queue % RADIX) as usize], a[(queue / RADIX) as usize]);
    }
    Ok(out.finish())
}

/// Format-3 UTF-16 code units, without a document BOM. Hash original bytes,
/// append the optional trailer, XOR actual bytes, and zero-pad only the final
/// packed pair. The header length always includes the trailer.
pub fn encode_units(data: &[u8], options: &EncodeOptions) -> Result<Vec<u16>, String> {
    encode::<Units>(data, options)
}
/// UTF-8 Rust string for callers doing their own document/text serialization.
pub fn encode_text(data: &[u8], options: &EncodeOptions) -> Result<String, String> {
    encode::<Text>(data, options)
}
/// Direct UTF-16LE bytes, without an intermediate u16 buffer or document BOM.
pub fn dense16(data: &[u8], options: &EncodeOptions) -> Result<Vec<u8>, String> {
    encode::<LittleEndian>(data, options)
}
