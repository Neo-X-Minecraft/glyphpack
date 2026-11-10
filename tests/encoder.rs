//! Differential format checks against a frozen generic encoder, including
//! partial digest boundaries, sampled ranking and extended length headers.
use glyphpack::{encoder as current, hash};
#[allow(dead_code)]
#[path = "../benchmarks/fixtures/encoder-v0.2.1.rs"]
mod reference;

fn compare(data: &[u8], mode: current::Integrity, mask: Option<u8>, effort: current::Effort) {
    let options = current::EncodeOptions {
        integrity: mode,
        mask,
        effort,
        legacy: false,
    };
    let before = reference::EncodeOptions {
        integrity: reference::Integrity::parse(mode.name()).unwrap(),
        mask,
        effort: if effort == current::Effort::Fast {
            reference::Effort::Fast
        } else {
            reference::Effort::Full
        },
        legacy: false,
    };
    assert_eq!(
        current::dense16(data, &options).unwrap(),
        reference::dense16(data, &before).unwrap()
    );
    assert_eq!(
        current::encode_units(data, &options).unwrap(),
        reference::encode_units(data, &before).unwrap()
    );
    assert_eq!(
        current::encode_text(data, &options).unwrap(),
        reference::encode_text(data, &before).unwrap()
    );
}

#[test]
fn golden_encoder_bytes_across_backends_and_sampling_boundary() {
    let mut state = 83u32;
    for n in (0..40).chain([63, 65, 127, 1023, 32737, 32765, 32768, 32769, 65537]) {
        let data: Vec<_> = (0..n)
            .map(|_| {
                state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                (state >> 24) as u8
            })
            .collect();
        for mode in [
            current::Integrity::None,
            current::Integrity::Fast,
            current::Integrity::Secure,
        ] {
            if n < 2048 {
                for mask in [Some(0), Some(127), Some(255), None] {
                    compare(&data, mode, mask, current::Effort::Full);
                }
            } else {
                compare(&data, mode, None, current::Effort::Fast);
            }
        }
    }
}

#[test]
fn extended_headers_with_virtual_digest_tails() {
    for n in [32 * 63385 - 33, 32 * 63385 - 32, 32 * 63385 - 31] {
        let data: Vec<_> = (0..n).map(|i| i as u8).collect();
        let a = current::EncodeOptions {
            mask: Some(255),
            ..Default::default()
        };
        let b = reference::EncodeOptions {
            mask: Some(255),
            ..Default::default()
        };
        assert_eq!(
            current::dense16(&data, &a).unwrap(),
            reference::dense16(&data, &b).unwrap()
        );
    }
}

#[test]
#[cfg(feature = "parallel-encoder")]
fn optional_parallel_search_preserves_order_and_bytes() {
    let mut state = 91u32;
    let data: Vec<_> = (0..300001)
        .map(|_| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            (state >> 24) as u8
        })
        .collect();
    let a = current::choose_mask(&data, current::Effort::Full);
    let b = reference::choose_mask(&data, reference::Effort::Full);
    assert_eq!(
        (a.mask, a.pairs, a.baseline_pairs, a.candidates),
        (b.mask, b.pairs, b.baseline_pairs, b.candidates)
    );
    compare(
        &data,
        current::Integrity::Secure,
        None,
        current::Effort::Full,
    );
}
