//! 0BSD, NeoX. Exercise the exact Wasm arithmetic natively, with varied states,
//! masks, all short lengths, the old 4 KiB boundary and truncation failures.
use glyphpack::utf8_compact;
const CHARACTER: u32 = 1;
const LENGTH: u32 = 2;
const PADDING: u32 = 4;
#[path = "../crates/decoder-wasm/src/utf8_compact.rs"]
mod kernel;
const DIGITS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
fn packet(text: &str) -> (Vec<u16>, usize, u64, u8) {
    let chars: Vec<_> = text.chars().collect();
    assert_eq!(&chars[..3], &['~', 'c', '2']);
    let digit = |c: char| DIGITS.find(c).unwrap();
    let mask = (digit(chars[3]) | (digit(chars[4]) << 6)) as u8;
    let mut at = 5;
    let mut size = 0;
    let mut power = 1;
    loop {
        let d = digit(chars[at]);
        at += 1;
        size += (d & 31) * power;
        power *= 32;
        if d & 32 == 0 {
            break;
        }
    }
    let mut state = 0;
    for i in 0..7 {
        state |= (digit(chars[at]) as u64) << (i * 6);
        at += 1;
    }
    let body: String = chars[at..].iter().collect();
    (
        body.replace("<\x01\x01\x01", "<").encode_utf16().collect(),
        size,
        state,
        mask,
    )
}
#[test]
fn ans_arithmetic_and_masks() {
    let mut seed = 815u32;
    for n in (0..=128).chain([129, 255, 256, 257, 1023, 1024, 4095, 4096, 4097, 65535]) {
        let data: Vec<_> = (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 24) as u8
            })
            .collect();
        for mask in [0, 1, 85, 127, 255] {
            let text = utf8_compact::encode(&data, Some(mask)).unwrap();
            let (body, size, state, mask) = packet(&text);
            let mut out = vec![0; size];
            assert_eq!(
                kernel::unpack::<true>(&body, &mut out, state, mask),
                0,
                "size {n}"
            );
            assert_eq!(out, data);
            if n > 0 {
                assert_ne!(
                    kernel::unpack::<true>(&body[..body.len() - 1], &mut out, state, mask),
                    0
                );
            }
        }
    }
}
#[test]
fn all_alphabet_classes_and_bad_symbols() {
    for cp in [0, 13, 0xd800, 0xdfff, 0xfdd0, 0xfdef, 0xfffe, 0xffff] {
        let mut output = [0; 32];
        assert_eq!(
            kernel::unpack::<true>(&[cp], &mut output, 1 << 30, 0),
            CHARACTER
        );
    }
    // Every permitted character is mapped within the Q-sized CDF. Exercise every digit and gap without an out-of-bounds store or panic.
    for cp in 0..=65535u16 {
        let mut out = [0; 4];
        let _ = kernel::unpack::<true>(&[cp], &mut out, (1u64 << 38) - 1, 0);
    }
}

#[test]
fn canonical_termination_is_optional() {
    let mut out = [];
    let alias = [1];
    let state = 58821 * 128;
    assert_eq!(kernel::unpack::<true>(&alias, &mut out, state, 0), PADDING);
    assert_eq!(kernel::unpack::<false>(&alias, &mut out, state, 0), 0);
}
