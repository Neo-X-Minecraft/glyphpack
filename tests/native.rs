//! Wire-format and build compatibility fixtures were captured before the Rust
//! extraction. They are data, so this suite needs no copy of the old tooling.
use glyphpack::{
    builder::{build_decoder, BuildOptions},
    encoder::{self, Effort, EncodeOptions, Integrity},
    hash, injector,
    tooling::fixtures::hex,
};
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path};
fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn official_blake3_vectors() {
    let v: Value = serde_json::from_str(include_str!("fixtures/blake3-vectors.json")).unwrap();
    for row in v["cases"].as_array().unwrap() {
        let size = row["input_len"].as_u64().unwrap() as usize;
        let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
        assert_eq!(
            hex(&hash::blake3(&data)),
            row["hash"].as_str().unwrap()[..64],
            "length {size}"
        );
    }
}
#[test]
fn xxhash_known_answers() {
    assert_eq!(hash::xxhash32(b""), 0x02cc5d05);
    assert_eq!(hash::xxhash32(b"a"), 0x550d7456);
    assert_eq!(hash::xxhash32(b"abc"), 0x32d153ff);
}

#[test]
fn gzip_handles_input_larger_than_process_pipes() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let mut seed = 833u32;
    let input: Vec<u8> = (0..262144)
        .map(|_| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 24) as u8
        })
        .collect();
    let compressed = glyphpack::transport::gzip9(&input).unwrap();
    let mut child = Command::new("gzip")
        .args(["-d", "-c"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut pipe = child.stdin.take().unwrap();
    let decoded = std::thread::scope(|scope| {
        let writer = scope.spawn(move || pipe.write_all(&compressed));
        let output = child.wait_with_output().unwrap();
        writer.join().unwrap().unwrap();
        assert!(output.status.success());
        output.stdout
    });
    assert_eq!(decoded, input);
}
#[test]
fn original_wire_format() {
    let rows: Value = serde_json::from_str(
        &fs::read_to_string(root().join("tests/fixtures/encoder-golden.json")).unwrap(),
    )
    .unwrap();
    for row in rows.as_array().unwrap() {
        let n = row["size"].as_u64().unwrap() as usize;
        let data: Vec<u8> = (0..n).map(|i| (i * 73 + 19) as u8).collect();
        let options = EncodeOptions {
            integrity: Integrity::parse(row["mode"].as_str().unwrap()).unwrap(),
            mask: row["mask"].as_u64().map(|n| n as u8),
            ..EncodeOptions::default()
        };
        let encoded = encoder::dense16(&data, &options).unwrap();
        assert_eq!(
            encoded.len(),
            row["bytes"].as_u64().unwrap() as usize,
            "{row}"
        );
        assert_eq!(
            hex(&hash::blake3(&encoded)),
            row["digest"].as_str().unwrap(),
            "{row}"
        );
    }
}
#[test]
fn all_63_specialized_wasm_builds() {
    let mut unique = std::collections::BTreeSet::new();
    for options in glyphpack::tooling::profiles::matrix() {
        let path = glyphpack::builder::build_wasm(&options).unwrap();
        let bytes = fs::read(path).unwrap();
        assert!(bytes.starts_with(b"\0asm\x01\0\0\0"), "{options:?}");
        unique.insert(glyphpack::builder::profile_key(&options));
    }
    assert_eq!(unique.len(), 63);
}
#[test]
fn mask_search_is_exact_and_fast_never_regresses() {
    for data in [
        vec![0; 4096],
        vec![255; 4096],
        (0..16384).map(|i| (i * 73 + 19) as u8).collect(),
    ] {
        let selection = encoder::choose_mask(&data, Effort::Full);
        assert_eq!(
            selection.pairs,
            (0..=255)
                .map(|m| encoder::count_pairs(&data, m))
                .min()
                .unwrap()
        );
        assert!(encoder::choose_mask(&data, Effort::Fast).pairs <= encoder::count_pairs(&data, 0));
    }
    assert_eq!(encoder::alphabet().len(), encoder::RADIX as usize);
    assert!(!encoder::alphabet().contains(&60));
}
#[test]
fn injector_preserves_raw_text_and_replaces_once() {
    let map = BTreeMap::from([
        ("__A__".into(), "__B__".into()),
        ("__B__".into(), "done".into()),
    ]);
    assert_eq!(
        injector::inject_html("__A__ __B__", &map).unwrap(),
        "__B__ done"
    );
    assert_eq!(injector::inject_html("λ__A__", &map).unwrap(), "λ__B__");
    assert_eq!(
        injector::inject_html("abc", &BTreeMap::new()).unwrap(),
        "abc"
    );
    assert!(injector::payload_element("data", "</script>", &BTreeMap::new()).is_err());
    assert!(injector::payload_element(
        "data",
        "abc",
        &BTreeMap::from([("bad name".into(), "x".into())])
    )
    .is_err());
    let element = injector::payload_element("name\"<&", "&amp;λ'", &BTreeMap::new()).unwrap();
    assert!(element.contains("id=\"name&quot;&lt;&amp;\""));
    assert!(element.contains(">&amp;λ'</script>"));
    assert_eq!(&injector::utf16_document("x")[..2], &[255, 254]);
}
#[test]
fn invalid_build_choices_and_minimal_code() {
    assert!(build_decoder(&BuildOptions {
        data: vec![],
        ..BuildOptions::default()
    })
    .is_err());
    assert!(build_decoder(&BuildOptions {
        legacy: true,
        ..BuildOptions::default()
    })
    .is_err());
    let source = build_decoder(&BuildOptions {
        formats: vec![false],
        data: vec![Integrity::None],
        ..BuildOptions::default()
    })
    .unwrap();
    for unwanted in [
        "imul",
        "Payload digest",
        "Payload checksum",
        "options",
        "Invalid payload character",
        "Invalid payload padding",
        "Uint32Array",
    ] {
        assert!(!source.contains(unwanted), "{unwanted}");
    }
    assert!(source.contains("DecompressionStream"));
    assert!(source.contains("await"));
    assert!(!source.contains("radix"));
}
