//! 0BSD, NeoX. Current compact UTF-8 ANS transport and reversible HTML guards.
#[path = "utf8-compact/ans.rs"]
mod ans;
pub use ans::encode;
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
        _ => unreachable!(),
    };
    char::from_u32(cp).unwrap()
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn alphabet_and_guards() {
        for (w, count) in [(1, 126), (2, 1920), (3, 61406)] {
            for d in 0..count {
                let c = point(d, w);
                assert_eq!(c.len_utf8(), w);
                let n = c as u32;
                assert_ne!(n, 0);
                assert_ne!(n, 13);
                assert!(!(0xfdd0..=0xfdef).contains(&n));
                assert!(n & 65535 < 65534);
            }
        }
        for text in ["</ScRiPt>", "<script", "<!--", "<\x01\x01\x01"] {
            let guarded = protect(text);
            assert_ne!(guarded, text);
            assert_eq!(guarded.replace("<\x01\x01\x01", "<"), text);
        }
    }
}
