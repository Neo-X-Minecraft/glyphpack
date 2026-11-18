//! Payload codec identifiers, shared by native encoding and the no_std decoder.
//! These HTML-preserved control units are reserved outside the pair alphabet,
//! so the single-unit field is distinct from a pair header.
pub const PAIR_TAG: u16 = 9;
pub const ANS_TAG: u16 = 10;
pub const WINDOWS_TAG: u16 = 12;
/// Vertical tab is outside the pair alphabet and survives HTML text nodes.
pub const UTF8_TAG: u16 = 11;
pub const UTF8_COMPACT_TAG: u16 = 14;
/// Half-open ranges in the current BMP alphabet order. Contiguous
/// spans let table initialization avoid a branch for every code point.
pub const UNICODE_RANGES: [(usize, usize); 7] = [
    (32, 60),
    (61, 127),
    (160, 8232),
    (8234, 55296),
    (57344, 64976),
    (65008, 65279),
    (65280, 65534),
];
pub const WINDOWS_C1: [u16; 32] = [
    8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141, 381, 143, 144,
    8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 157, 382, 376,
];
pub fn windows_code_point(byte: u8) -> u16 {
    match byte {
        0 => 65533,
        128..=159 => WINDOWS_C1[(byte - 128) as usize],
        _ => u16::from(byte),
    }
}
pub fn windows_source_byte(c: u16) -> Option<u8> {
    match c {
        0 | 65533 => Some(0),
        1..=127 | 160..=255 => Some(c as u8),
        _ => WINDOWS_C1
            .iter()
            .position(|&v| v == c)
            .map(|i| i as u8 + 128),
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Packing {
    Pair,
    Ans,
    Windows,
    Utf8,
    Utf8Compact,
}
impl Packing {
    pub fn name(self) -> &'static str {
        match self {
            Self::Pair => "pair",
            Self::Ans => "ans",
            Self::Windows => "windows",
            Self::Utf8 => "utf8",
            Self::Utf8Compact => "utf8-compact",
        }
    }
    pub fn tag(self) -> u16 {
        match self {
            Self::Pair => PAIR_TAG,
            Self::Ans => ANS_TAG,
            Self::Windows => WINDOWS_TAG,
            Self::Utf8 => UTF8_TAG,
            Self::Utf8Compact => UTF8_COMPACT_TAG,
        }
    }
    pub fn parse(s: &str) -> Result<Self, &'static str> {
        match s {
            "pair" => Ok(Self::Pair),
            "ans" => Ok(Self::Ans),
            "windows" | "windows1252" => Ok(Self::Windows),
            "utf8" | "utf-8" => Ok(Self::Utf8),
            "utf8-compact" => Ok(Self::Utf8Compact),
            _ => Err("packing must be pair, ans, windows, utf8 or utf8-compact"),
        }
    }
    pub fn is_utf8(self) -> bool {
        matches!(self, Self::Utf8 | Self::Utf8Compact)
    }
}
