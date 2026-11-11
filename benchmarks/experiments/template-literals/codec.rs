//! Local density experiment, 0BSD, NeoX. These alternate alphabets are NOT
//! format-3 compatible. Keep the packing/header/trailer structure constant to
//! isolate alphabet and source-escaping costs from unrelated format changes.
use glyphpack::encoder;

#[derive(Clone, Copy, Debug)]
pub enum Context {
    RawText,
    Cooked,
    Tagged,
}
pub struct Profile {
    pub name: &'static str,
    pub context: Context,
    pub alphabet: Vec<u16>,
}
/// WHATWG Windows-1252's 256 distinct values. In a script data block the HTML
/// tokenizer maps source NUL to U+FFFD. That is an intentional transport digit,
/// not an expected NUL string character; no other byte maps to U+FFFD.
pub fn byte_alphabet(nul_digit: bool) -> Vec<u16> {
    let mut map: Vec<_> = (0..=255u16).collect();
    map[128..160].copy_from_slice(&[
        8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141, 381, 143,
        144, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 157, 382, 376,
    ]);
    if nul_digit {
        map[0] = 0xfffd;
    }
    map
}
pub fn profiles() -> Vec<Profile> {
    let wide = |excluded: &[u16], surrogates: bool| {
        (0..=65535u16)
            .filter(|c| (surrogates || !(0xd800..=0xdfff).contains(c)) && !excluded.contains(c))
            .collect()
    };
    let byte = |excluded: &[u16], nul_digit| {
        byte_alphabet(nul_digit)
            .into_iter()
            .filter(|c| !excluded.contains(c))
            .collect()
    };
    vec![
        Profile {
            name: "current-rawtext",
            context: Context::RawText,
            alphabet: encoder::alphabet().to_vec(),
        },
        Profile {
            name: "current-template",
            context: Context::Cooked,
            alphabet: encoder::alphabet().to_vec(),
        },
        Profile {
            name: "wide-rawtext",
            context: Context::RawText,
            alphabet: wide(&[0, 13, 60], false),
        },
        Profile {
            name: "wide-template",
            context: Context::Cooked,
            alphabet: wide(&[0, 13, 92, 96], false),
        },
        Profile {
            name: "wide-template-reserve-dollar",
            context: Context::Cooked,
            alphabet: wide(&[0, 13, 36, 92, 96], false),
        },
        Profile {
            name: "wide-template-escaped",
            context: Context::Cooked,
            alphabet: wide(&[0, 13], false),
        },
        Profile {
            name: "all-bmp-escaped",
            context: Context::Cooked,
            alphabet: wide(&[], false),
        },
        Profile {
            name: "all-utf16-escaped",
            context: Context::Cooked,
            alphabet: wide(&[], true),
        },
        Profile {
            name: "wide-raw-tag",
            context: Context::Tagged,
            alphabet: wide(&[0, 13, 96], false),
        },
        Profile {
            name: "wide-template-no-escapes",
            context: Context::Cooked,
            alphabet: wide(&[0, 13, 36, 60, 92, 96], false),
        },
        Profile {
            name: "byte-template",
            context: Context::Cooked,
            alphabet: byte(&[13, 92, 96], true),
        },
        Profile {
            name: "byte-raw-tag",
            context: Context::Tagged,
            alphabet: byte(&[13, 96], true),
        },
        Profile {
            name: "byte-rawtext",
            context: Context::RawText,
            alphabet: byte(&[13, 60], true),
        },
        Profile {
            name: "byte-template-no-escapes",
            context: Context::Cooked,
            alphabet: byte(&[13, 36, 60, 92, 96], true),
        },
        Profile {
            name: "byte-template-full",
            context: Context::Cooked,
            alphabet: byte(&[], true),
        },
        Profile {
            name: "byte-raw-tag-no-nul",
            context: Context::Tagged,
            alphabet: byte(&[0, 13, 96], false),
        },
    ]
}

/// Same variable-pair construction: 31/32 bits for BMP, 15/16 for single-byte.
pub fn count(data: &[u8], mask: u8, radix: u64) -> usize {
    let max_bits = if radix <= 256 { 16 } else { 32 };
    let low_mask = (1u64 << (max_bits - 1)) - 1;
    let threshold = radix * radix - low_mask - 2;
    let (mut queue, mut bits, mut pairs) = (0u64, 0, 0);
    for part in data.chunks(4) {
        let word = part
            .iter()
            .enumerate()
            .fold(0u64, |q, (i, b)| q | (u64::from(b ^ mask) << (8 * i)));
        queue |= word << bits;
        bits += part.len() * 8;
        while bits >= max_bits {
            let width = if queue & low_mask > threshold {
                max_bits - 1
            } else {
                max_bits
            };
            queue >>= width;
            bits -= width;
            pairs += 1;
        }
    }
    pairs + usize::from(bits > 0)
}
pub fn pack(data: &[u8], mask: u8, alphabet: &[u16]) -> Vec<u16> {
    let radix = alphabet.len() as u64;
    let max_bits = if radix <= 256 { 16 } else { 32 };
    let low_mask = (1u64 << (max_bits - 1)) - 1;
    let full_mask = (1u64 << max_bits) - 1;
    let threshold = radix * radix - low_mask - 2;
    let n = data.len() as u64;
    let settings = u64::from(mask) | 512; // Same 32-byte BLAKE3 trailer in every candidate.
    let mut out = Vec::with_capacity((data.len() * 8).div_ceil(max_bits - 1) * 2 + 6);
    if radix <= 256 {
        out.push(alphabet[(settings % radix) as usize]);
        out.push(alphabet[(settings / radix) as usize]);
        let mut length = n;
        for _ in 0..4 {
            out.push(alphabet[(length % radix) as usize]);
            length /= radix;
        }
        assert_eq!(length, 0);
    } else if n < 32 * radix {
        out.push(alphabet[(settings + 1024 * (n / radix)) as usize]);
        out.push(alphabet[(n % radix) as usize]);
    } else {
        out.push(alphabet[(32768 + settings) as usize]);
        out.push(alphabet[(n % radix) as usize]);
        out.push(alphabet[(n / radix) as usize]);
    }
    let (mut queue, mut bits) = (0u64, 0);
    for part in data.chunks(4) {
        let word = part
            .iter()
            .enumerate()
            .fold(0u64, |q, (i, b)| q | (u64::from(b ^ mask) << (8 * i)));
        queue |= word << bits;
        bits += part.len() * 8;
        while bits >= max_bits {
            let width = if queue & low_mask > threshold {
                max_bits - 1
            } else {
                max_bits
            };
            let v = queue
                & if width == max_bits - 1 {
                    low_mask
                } else {
                    full_mask
                };
            out.push(alphabet[(v % radix) as usize]);
            out.push(alphabet[(v / radix) as usize]);
            queue >>= width;
            bits -= width;
        }
    }
    if bits > 0 {
        out.push(alphabet[(queue % radix) as usize]);
        out.push(alphabet[(queue / radix) as usize]);
    }
    out
}
fn starts(text: &[u16], ascii: &[u8]) -> bool {
    text.len() >= ascii.len()
        && text
            .iter()
            .zip(ascii)
            .all(|(&a, &b)| a <= 127 && (a as u8).eq_ignore_ascii_case(&b))
}
fn html_hazard(after_less_than: &[u16]) -> bool {
    // Prevent entering the HTML escaped-script state at all, and prevent end
    // tags. Matching the prefix conservatively also protects every tag delimiter.
    starts(after_less_than, b"!--") || starts(after_less_than, b"/script")
}
fn ascii(out: &mut Vec<u16>, text: &str) {
    out.extend(text.bytes().map(u16::from));
}
fn hex_escape(out: &mut Vec<u16>, unit: u16) {
    const HEX: &[u8] = b"0123456789abcdef";
    ascii(out, "\\u");
    for shift in [12, 8, 4, 0] {
        out.push(u16::from(HEX[((unit >> shift) & 15) as usize]));
    }
}

/// Untagged literals use JavaScript's native cooked value. Escape only syntax,
/// HTML state transitions and code units that HTML/UTF-16 would otherwise alter.
/// Pairs of valid surrogates survive verbatim; lone surrogates use Unicode escapes.
pub fn cooked(text: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        let c = text[i];
        match c {
            0 => ascii(
                &mut out,
                if text.get(i + 1).is_some_and(|c| (48..=57).contains(c)) {
                    "\\x00"
                } else {
                    "\\0"
                },
            ),
            13 => ascii(&mut out, "\\r"),
            92 | 96 => {
                out.push(92);
                out.push(c);
            }
            36 if text.get(i + 1) == Some(&123) => {
                out.push(92);
                out.push(c);
            }
            60 if html_hazard(&text[i + 1..]) => {
                // One extra unit suffices: slash/exclamation identity escapes.
                out.push(60);
                out.push(92);
            }
            0xd800..=0xdbff
                if text
                    .get(i + 1)
                    .is_some_and(|c| (0xdc00..=0xdfff).contains(c)) =>
            {
                out.push(c);
                i += 1;
                out.push(text[i]);
            }
            0xd800..=0xdfff => hex_escape(&mut out, c),
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

/// A tagged literal keeps most backslashes unchanged. Reserve ONLY runs before
/// interpolation and HTML hazards: k original slashes become 2k+1 source slashes.
/// This is injective, including existing lookalike escape sequences. A final
/// exclamation sentinel stops an odd trailing slash escaping the closing quote.
pub fn tagged(text: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(text.len() + 1);
    let mut i = 0;
    while i < text.len() {
        let c = text[i];
        assert!(![0, 13, 96].contains(&c) && !(0xd800..=0xdfff).contains(&c));
        if c == 60 {
            let mut j = i + 1;
            while text.get(j) == Some(&92) {
                j += 1;
            }
            if html_hazard(&text[j..]) {
                out.push(60);
                out.extend(std::iter::repeat_n(92, 2 * (j - i - 1) + 1));
                i = j;
                continue;
            }
        }
        if c == 92 || c == 36 {
            let mut j = i;
            while text.get(j) == Some(&92) {
                j += 1;
            }
            if text.get(j..j + 2) == Some(&[36, 123]) {
                out.extend(std::iter::repeat_n(92, 2 * (j - i) + 1));
                out.extend([36, 123]);
                i = j + 2;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out.push(33);
    out
}
pub fn source(text: &[u16], context: Context) -> Vec<u16> {
    match context {
        Context::RawText => text.to_vec(),
        Context::Cooked => cooked(text),
        Context::Tagged => tagged(text),
    }
}

/// Search ALL 256 masks in stable production priority, but minimize SOURCE size,
/// including escaping. Pair counts provide an admissible lower bound, avoiding
/// most allocations. A theoretical-minimum source has no possible improvement.
pub fn choose(data: &[u8], profile: &Profile) -> (u8, Vec<u16>, Vec<u16>, usize) {
    let priority = [0, 255, 85, 170, 51, 204, 15, 240];
    let masks = priority
        .into_iter()
        .chain((1..=255u8).filter(|m| !priority.contains(m)));
    let header = if profile.alphabet.len() <= 256 {
        6
    } else if data.len() < 32 * profile.alphabet.len() {
        2
    } else {
        3
    };
    let suffix = usize::from(matches!(profile.context, Context::Tagged));
    let max_bits = if profile.alphabet.len() <= 256 {
        16
    } else {
        32
    };
    let minimum = (data.len() * 8).div_ceil(max_bits) * 2 + header + suffix;
    let mut best = (0, Vec::new(), Vec::new(), 0);
    let mut best_size = usize::MAX;
    for mask in masks {
        best.3 += 1;
        let lower = count(data, mask, profile.alphabet.len() as u64) * 2 + header + suffix;
        if lower >= best_size {
            continue;
        }
        let packet = pack(data, mask, &profile.alphabet);
        let escaped = source(&packet, profile.context);
        if escaped.len() < best_size {
            best_size = escaped.len();
            best.0 = mask;
            best.1 = packet;
            best.2 = escaped;
            if best_size == minimum {
                break;
            }
        }
    }
    best
}
