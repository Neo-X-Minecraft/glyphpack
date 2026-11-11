//! New-format and cross-codec fixtures, generated natively for browser QA.
use crate::{
    builder::{self, BuildOptions},
    encoder::{self, EncodeOptions, Integrity, Packing},
    hash,
    tooling::fixtures::hex,
};
use serde_json::json;
use std::{fs, path::Path};
pub fn prepare(root: &Path) -> Result<std::path::PathBuf, String> {
    let folder = root.join("generated/codecs");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut builds = Vec::new();
    for mask in 1..8u8 {
        let packings: Vec<_> = [Packing::Pair, Packing::Ans, Packing::Windows]
            .into_iter()
            .enumerate()
            .filter_map(|(i, p)| if mask & (1 << i) != 0 { Some(p) } else { None })
            .collect();
        for core in [false, true] {
            let options = BuildOptions {
                packings: packings.clone(),
                ..if core {
                    BuildOptions {
                        formats: vec![false],
                        data: vec![Integrity::None],
                        ..Default::default()
                    }
                } else {
                    BuildOptions::full()
                }
            };
            let source = builder::build_decoder(&options)?;
            let wasm = builder::build_wasm(&options)?;
            builds.push(json!({"packings":packings.iter().map(|p|p.name()).collect::<Vec<_>>(),"core":core,"source":source,"wasm":wasm}));
        }
    }
    let mut rows = Vec::new();
    let mut seed = 815u32;
    for n in (0..40).chain([
        63, 64, 65, 127, 128, 129, 255, 256, 257, 1023, 1024, 1025, 4097,
    ]) {
        for fill in [None, Some(0), Some(255)] {
            let data: Vec<u8> = (0..n)
                .map(|_| {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    fill.unwrap_or((seed >> 24) as u8)
                })
                .collect();
            for mask in [0, 85, 255] {
                for kind in [Integrity::None, Integrity::Fast, Integrity::Secure] {
                    let mut packets = serde_json::Map::new();
                    for p in [Packing::Pair, Packing::Ans, Packing::Windows] {
                        let options = EncodeOptions {
                            packing: p,
                            integrity: kind,
                            mask: Some(mask),
                            ..Default::default()
                        };
                        packets.insert(
                            p.name().into(),
                            json!(encoder::encode_text(&data, &options)?),
                        );
                    }
                    rows.push(json!({"rawHex":hex(&data),"kind":kind.name(),"mask":mask,"packets":packets}));
                }
            }
        }
    }
    // Canonical wrong-digest packets: encode altered stored bytes with no
    // trailer, then change ONLY header integrity metadata. This independently
    // exercises the shared verifier, rather than relying on invalid padding.
    for kind in [Integrity::Fast, Integrity::Secure] {
        let data: Vec<u8> = (0..257).map(|i| i as u8).collect();
        let mut stored = data.clone();
        match kind {
            Integrity::Fast => stored.extend(hash::xxhash32(&data).to_le_bytes()),
            _ => stored.extend(hash::blake3(&data)),
        };
        stored[0] ^= 1;
        let mut packets = serde_json::Map::new();
        for p in [Packing::Pair, Packing::Ans, Packing::Windows] {
            let mut units = encoder::encode_units(
                &stored,
                &EncodeOptions {
                    packing: p,
                    integrity: Integrity::None,
                    mask: Some(0),
                    ..Default::default()
                },
            )?;
            if p == Packing::Windows {
                let a: Vec<_> = (0..=255u8)
                    .filter(|&b| b != 13 && b != 60)
                    .map(crate::packing::windows_code_point)
                    .collect();
                let settings = kind.kind() as usize * 256;
                units[1] = a[settings % 254];
                units[2] = a[settings / 254];
            } else {
                let a = encoder::alphabet();
                let first = a.binary_search(&units[1]).unwrap();
                units[1] = a[first + kind.kind() as usize * 256];
            }
            packets.insert(p.name().into(), json!(String::from_utf16(&units).unwrap()));
        }
        rows.push(json!({"reject":true,"kind":kind.name(),"rawHex":"","mask":0,"packets":packets}));
    }
    let mut large = Vec::new();
    for (n, label) in [
        (65537, "odd"),
        (1048576, "large"),
        (32 * encoder::RADIX as usize + 1, "extended"),
    ] {
        let data: Vec<u8> = (0..n).map(|i| (i * 73 + 19) as u8).collect();
        let expected = hex(&hash::blake3(&data));
        for p in [Packing::Pair, Packing::Ans, Packing::Windows] {
            let text = encoder::encode_text(
                &data,
                &EncodeOptions {
                    packing: p,
                    mask: Some(85),
                    ..Default::default()
                },
            )?;
            let file = folder.join(format!("{label}-{}.utf16", p.name()));
            fs::write(
                &file,
                text.encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>(),
            )
            .map_err(|e| e.to_string())?;
            large.push(json!({"packing":p.name(),"size":n,"file":file,"blake3":expected}));
        }
    }
    let out = folder.join("vectors.json");
    fs::write(
        &out,
        serde_json::to_vec(&json!({"builds":builds,"rows":rows,"large":large})).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(out)
}
