//! Deterministic cross-language vectors. Native bytes never enter timing loops.
use crate::{
    builder::build_decoder,
    encoder::{self, EncodeOptions, Integrity},
    hash::{blake3, xxhash32},
};
use serde_json::{json, Value};
use std::{fs, path::Path};

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn from_hex(text: &str) -> Result<Vec<u8>, String> {
    if text.len() % 2 != 0 {
        return Err("Odd hex length".into());
    }
    text.as_bytes()
        .chunks(2)
        .map(|p| {
            let digit = |c: u8| match c {
                b'0'..=b'9' => Ok(c - b'0'),
                b'a'..=b'f' => Ok(c - b'a' + 10),
                b'A'..=b'F' => Ok(c - b'A' + 10),
                _ => Err("Invalid hex digit".to_string()),
            };
            Ok((digit(p[0])? << 4) | digit(p[1])?)
        })
        .collect()
}
pub fn packets(data: &[u8], mask: Option<u8>) -> Result<Value, String> {
    let mut out = serde_json::Map::new();
    for integrity in [Integrity::None, Integrity::Fast, Integrity::Secure] {
        out.insert(
            integrity.name().into(),
            json!(encoder::encode_text(
                data,
                &EncodeOptions {
                    integrity,
                    mask,
                    ..EncodeOptions::default()
                }
            )?),
        );
    }
    Ok(Value::Object(out))
}

pub fn test_vectors(root: &Path) -> Result<Value, String> {
    let mut profiles = Vec::new();
    for options in super::profiles::matrix() {
        profiles.push(json!({"formats":options.formats,"modes":options.data.iter().map(|m|m.name()).collect::<Vec<_>>(),"memories":options.memory,"source":build_decoder(&options)?}));
    }
    let mut rows = Vec::new();
    let mut state = 0x812331u32;
    for size in [
        0, 1, 2, 3, 4, 7, 15, 16, 17, 31, 32, 63, 64, 127, 128, 255, 256, 1023, 1024, 1025, 4097,
    ] {
        let data: Vec<u8> = (0..size)
            .map(|_| {
                state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                (state >> 24) as u8
            })
            .collect();
        for mask in [0, 127, 255] {
            rows.push(json!({"rawHex":hex(&data),"packets":packets(&data,Some(mask))?}));
        }
    }
    let raw = vec![0; 256];
    let baseline =
        fs::read_to_string(root.join("tests/reference/full.js")).map_err(|e| e.to_string())?;
    let mut extended = Vec::new();
    for size in [
        (32 * encoder::RADIX - 1) as usize,
        (32 * encoder::RADIX) as usize,
        (32 * encoder::RADIX + 1) as usize,
    ] {
        let data = vec![255; size];
        extended.push(
            json!({"size":size,"packets":packets(&data,Some(255))?,"digest":hex(&blake3(&data))}),
        );
    }
    let mut hash_cases = Vec::new();
    for size in [
        0, 1, 3, 4, 7, 15, 16, 17, 63, 64, 65, 1023, 1024, 1025, 2047, 2048, 2049, 65537,
    ] {
        let data: Vec<u8> = (0..size).map(|i| (i * 73 + 19) as u8).collect();
        hash_cases.push(
            json!({"rawHex":hex(&data),"xxh32":xxhash32(&data),"blake3":hex(&blake3(&data))}),
        );
    }
    Ok(
        json!({"profiles":profiles,"rows":rows,"zero":packets(&raw,Some(0))?,"alphabet":encoder::alphabet(),"baseline":baseline,"extended":extended,"hashes":hash_cases}),
    )
}

pub fn write_vectors(root: &Path) -> Result<std::path::PathBuf, String> {
    let folder = root.join("generated");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join("test-vectors.json");
    fs::write(&path, serde_json::to_vec(&test_vectors(root)?).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(path)
}
