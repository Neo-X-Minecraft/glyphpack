//! Differential format checks against a frozen generic encoder, including
//! partial digest boundaries, sampled ranking and extended length headers.
use glyphpack::encoder as current;
#[test]
fn codec_output_backends_and_windows_mapping() {
    use glyphpack::{injector, packing};
    let data: Vec<_> = (0..4097).map(|i| (i * 73 + 19) as u8).collect();
    for packing in [
        current::Packing::Pair,
        current::Packing::Ans,
        current::Packing::Windows,
    ] {
        let options = current::EncodeOptions {
            packing,
            mask: Some(85),
            ..Default::default()
        };
        let units = current::encode_units(&data, &options).unwrap();
        assert_eq!(units[0], packing.tag());
        let text = current::encode_text(&data, &options).unwrap();
        assert_eq!(text.encode_utf16().collect::<Vec<_>>(), units);
        assert!(!text.contains(['<', '\r']));
        let source = current::encode_bytes(&data, &options).unwrap();
        if packing == current::Packing::Windows {
            assert_eq!(source.len(), units.len());
            assert_eq!(injector::windows1252_payload_text(&source), text);
            assert_eq!(injector::windows1252_document(&text).unwrap(), source);
        } else {
            assert_eq!(source, current::dense16(&data, &options).unwrap());
        }
    }
    for byte in 0..=255u8 {
        assert_eq!(
            packing::windows_source_byte(packing::windows_code_point(byte)),
            Some(byte)
        );
    }
    assert!(injector::windows1252_document("unrepresentable: 漢").is_err());
}
