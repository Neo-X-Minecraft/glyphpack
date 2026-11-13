//! 0BSD, NeoX. Raw UTF-8 transport, separate from the integrity-checked codec API.
//! ASCII symbols carry 7 bits; the six Base122-forbidden prefixes select one
//! of 1,536 NFC-stable Unicode symbols carrying 15 bits in two UTF-8 bytes.
#[path = "utf8-raw/alphabet.rs"]
mod alphabet;
use alphabet::PORTABLE;
const DIGITS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ILLEGAL: [u8; 6] = [0, 10, 13, 34, 38, 92];

struct Reader<'a> {
    data: &'a [u8],
    mask: u8,
    at: usize,
    queue: u32,
    bits: u32,
    consumed: u64,
}
impl Reader<'_> {
    fn read(&mut self, n: u32) -> u32 {
        while self.bits < n {
            self.queue =
                (self.queue << 8) | u32::from(self.data.get(self.at).map_or(0, |b| b ^ self.mask));
            self.at += 1;
            self.bits += 8;
        }
        self.bits -= n;
        self.consumed += u64::from(n);
        (self.queue >> self.bits) & ((1 << n) - 1)
    }
}
fn body(data: &[u8], mask: u8, mut emit: impl FnMut(u16)) {
    let mut r = Reader {
        data,
        mask,
        at: 0,
        queue: 0,
        bits: 0,
        consumed: 0,
    };
    while r.consumed < data.len() as u64 * 8 {
        let first = r.read(7) as u8;
        if let Some(class) = ILLEGAL.iter().position(|&c| c == first) {
            let tail = r.read(8) as usize;
            emit(PORTABLE[class * 256 + tail]);
        } else {
            emit(u16::from(first));
        }
    }
}
fn score(data: &[u8], mask: u8) -> usize {
    let mut n = 0;
    body(data, mask, |c| n += if c < 128 { 1 } else { 2 });
    n
}
/// Bounded mask ranking, then complete scoring of four finalists and mask zero.
/// This cannot produce a larger body than the unmasked encoding.
pub fn select_mask(data: &[u8]) -> u8 {
    let sample = if data.len() > 4096 {
        [&data[..2048], &data[data.len() - 2048..]].concat()
    } else {
        data.to_vec()
    };
    let mut scores: Vec<_> = (0..=255u8).map(|m| (score(&sample, m), m)).collect();
    scores.sort_unstable();
    let mut masks = vec![0];
    for &(_, m) in scores.iter().take(4) {
        if !masks.contains(&m) {
            masks.push(m);
        }
    }
    masks
        .into_iter()
        .min_by_key(|&m| (score(data, m), m))
        .unwrap()
}
/// Encode bytes with an explicit XOR mask. No integrity trailer is appended:
/// this is the raw counterpart of Base122, not the secure encoder's default.
pub fn encode(data: &[u8], mask: u8) -> Result<String, String> {
    if data.len() > 0x40000000 {
        return Err("Payload too large".into());
    }
    let mut out = String::with_capacity(data.len() + data.len().div_ceil(7) + 32);
    out.push_str("~u2");
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
    body(data, mask, |c| {
        out.push(char::from_u32(u32::from(c)).unwrap())
    });
    Ok(out)
}
/// Escape content for a double-quoted JavaScript literal in an HTML script.
/// Encoded packets already exclude quotes, backslashes, CR/LF and NUL; only
/// rare script-tokenizer transitions need escaping in their usual case.
/// The returned content has no surrounding quotes. Decoding JS escapes
/// recovers the original text, including for arbitrary non-packet strings.
pub fn script_literal(packet: &str) -> String {
    let bytes = packet.as_bytes();
    let mut out = String::with_capacity(packet.len());
    let mut from = 0;
    for (i, c) in packet.char_indices() {
        let escaped = match c {
            '"' => Some("\\\""),
            '\\' => Some("\\\\"),
            '\n' => Some("\\n"),
            '\r' => Some("\\r"),
            '\0' => Some("\\x00"),
            '\u{2028}' => Some("\\u2028"),
            '\u{2029}' => Some("\\u2029"),
            '<' => {
                let rest = &bytes[i..];
                if rest.starts_with(b"<!--")
                    || rest
                        .get(..7)
                        .is_some_and(|s| s.eq_ignore_ascii_case(b"<script"))
                    || rest
                        .get(..8)
                        .is_some_and(|s| s.eq_ignore_ascii_case(b"</script"))
                {
                    Some("\\x3c")
                } else {
                    None
                }
            }
            _ => None,
        };
        if let Some(escaped) = escaped {
            out.push_str(&packet[from..i]);
            out.push_str(escaped);
            from = i + c.len_utf8();
        }
    }
    out.push_str(&packet[from..]);
    out
}

/// Build the dependency-free browser decoder. Tools only; the encoder itself
/// does not need Node or esbuild. The classic form also works under file://.
#[cfg(feature = "tools")]
pub fn build_decoder(
    root: &std::path::Path,
    classic: bool,
    minify: bool,
) -> Result<String, String> {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let mut command = Command::new(root.join("node_modules/.bin/esbuild"));
    command.current_dir(root).args([
        "--bundle",
        "--loader=js",
        "--target=chrome109",
        "--legal-comments=none",
    ]);
    command.arg(if classic {
        "--format=iife"
    } else {
        "--format=esm"
    });
    if minify {
        command.arg("--minify");
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let source = if classic {
        "import{decode,warmup}from'./src/utf8-raw/decoder.mjs';globalThis.GlyphUTF8={decode,warmup};"
    } else {
        "export{decode,warmup}from'./src/utf8-raw/decoder.mjs';"
    };
    child
        .stdin
        .take()
        .unwrap()
        .write_all(source.as_bytes())
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_and_masks() {
        assert_eq!(encode(&[], 0).unwrap(), "~u2AAA");
        assert_eq!(&encode(&[], 255).unwrap()[..6], "~u2_DA");
        for n in [0, 1, 7, 8, 31, 32, 1023, 4097] {
            let data: Vec<u8> = (0..n).map(|i| (i * 73) as u8).collect();
            let mask = select_mask(&data);
            assert!(encode(&data, mask).unwrap().len() <= encode(&data, 0).unwrap().len());
        }
    }
    #[test]
    fn script_tokenizer_and_javascript_escaping() {
        let escaped = script_literal("</ScRiPt><!--<script\"\\\n\r\0\u{2028}\u{2029}✓");
        assert_eq!(
            escaped,
            "\\x3c/ScRiPt>\\x3c!--\\x3cscript\\\"\\\\\\n\\r\\x00\\u2028\\u2029✓"
        );
        assert_eq!(script_literal("<svg>αβ"), "<svg>αβ");
    }
}
