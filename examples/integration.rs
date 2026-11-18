//! 0BSD, NeoX. Five-codec integration fixtures and all 31 builder subsets.
use glyphpack::{
    builder::{self, BuildOptions},
    encoder::{self, EncodeOptions, Integrity, Packing},
    hash,
    tooling::fixtures::{from_hex, hex},
};
use serde_json::json;
use std::{fs, path::Path};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dir = root.join("generated/integration");
    fs::create_dir_all(&dir)?;
    let names = [
        Packing::Pair,
        Packing::Ans,
        Packing::Windows,
        Packing::Utf8,
        Packing::Utf8Compact,
    ];
    let mut builds = vec![];
    for bits in 1u32..32 {
        let packings: Vec<_> = names
            .iter()
            .enumerate()
            .filter_map(|(i, p)| if bits & (1 << i) != 0 { Some(*p) } else { None })
            .collect();
        let options = BuildOptions {
            packings: packings.clone(),
            ..BuildOptions::full()
        };
        let file = dir.join(format!("subset-{bits}.mjs"));
        fs::write(&file, builder::build_decoder(&options)?)?;
        builds.push(json!({"name":format!("subset-{bits}"),"file":file,"packings":packings.iter().map(|p|p.name()).collect::<Vec<_>>(),"data":["none","fast","secure"],"format":[false,true],"memory":options.packings.contains(&Packing::Pair)}));
    }
    for (label, packings, data, format) in [
        (
            "utf8-core",
            vec![Packing::Utf8],
            vec![Integrity::None],
            vec![false],
        ),
        (
            "compact-core",
            vec![Packing::Utf8Compact],
            vec![Integrity::None],
            vec![false],
        ),
        (
            "both-core",
            vec![Packing::Utf8, Packing::Utf8Compact],
            vec![Integrity::None],
            vec![false],
        ),
        (
            "both-strict",
            vec![Packing::Utf8, Packing::Utf8Compact],
            vec![Integrity::None],
            vec![true],
        ),
        (
            "both-fast",
            vec![Packing::Utf8, Packing::Utf8Compact],
            vec![Integrity::None, Integrity::Fast],
            vec![false, true],
        ),
        (
            "both-secure",
            vec![Packing::Utf8, Packing::Utf8Compact],
            vec![Integrity::Secure],
            vec![false, true],
        ),
    ] {
        let options = BuildOptions {
            packings: packings.clone(),
            data: data.clone(),
            formats: format.clone(),
            ..BuildOptions::default()
        };
        let file = dir.join(format!("{label}.mjs"));
        fs::write(&file, builder::build_decoder(&options)?)?;
        builds.push(json!({"name":label,"file":file,"packings":packings.iter().map(|p|p.name()).collect::<Vec<_>>(),"data":data.iter().map(|m|m.name()).collect::<Vec<_>>(),"format":format,"memory":false}));
    }
    let mut rows = vec![];
    for (label, options) in [
        (
            "compact-hash-full",
            BuildOptions {
                compact_hash: true,
                ..BuildOptions::full()
            },
        ),
        (
            "none-full",
            BuildOptions {
                formats: vec![false],
                data: vec![Integrity::None],
                memory: vec![false],
                ..BuildOptions::full()
            },
        ),
    ] {
        let file = dir.join(format!("{label}.mjs"));
        fs::write(&file, builder::build_decoder(&options)?)?;
        builds.push(json!({"name":label,"file":file,"packings":names.iter().map(|p|p.name()).collect::<Vec<_>>(),"data":options.data.iter().map(|k|k.name()).collect::<Vec<_>>(),"format":options.formats,"memory":options.memory.len()>1}));
    }
    let mut seed = 815u32;
    for n in [
        0, 1, 2, 3, 7, 8, 15, 16, 31, 32, 127, 128, 255, 256, 257, 1024, 4095, 4096, 4097,
    ] {
        let data: Vec<_> = (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 24) as u8
            })
            .collect();
        for mode in [Integrity::None, Integrity::Fast, Integrity::Secure] {
            for mask in [0, 85, 255] {
                let mut packets = serde_json::Map::new();
                for packing in names {
                    packets.insert(
                        packing.name().into(),
                        json!(encoder::encode_text(
                            &data,
                            &EncodeOptions {
                                packing,
                                integrity: mode,
                                mask: Some(mask),
                                ..Default::default()
                            }
                        )?),
                    );
                }
                rows.push(
                    json!({"hex":hex(&data),"mode":mode.name(),"mask":mask,"packets":packets}),
                );
            }
        }
    }
    let mut corrupt = vec![];
    // Structured inputs exercise compact's adaptive choice of the faster
    // representation whenever its serialized byte count is smaller.
    for fill in [0u8, 255] {
        for n in [256, 4096, 4097] {
            let data = vec![fill; n];
            for mode in [Integrity::None, Integrity::Fast, Integrity::Secure] {
                let mut packets = serde_json::Map::new();
                for packing in names {
                    packets.insert(
                        packing.name().into(),
                        json!(encoder::encode_text(
                            &data,
                            &EncodeOptions {
                                packing,
                                integrity: mode,
                                mask: None,
                                ..Default::default()
                            }
                        )?),
                    );
                }
                rows.push(json!({"hex":hex(&data),"mode":mode.name(),"mask":0,"packets":packets}));
            }
        }
    }
    for packing in [Packing::Utf8, Packing::Utf8Compact] {
        for mode in [Integrity::Fast, Integrity::Secure] {
            let data: Vec<_> = (0..257).map(|i| i as u8).collect();
            let mut stored = data.clone();
            if mode == Integrity::Fast {
                stored.extend(hash::xxhash32(&data).to_le_bytes());
            } else {
                stored.extend(hash::blake3(&data));
            }
            stored[0] ^= 1;
            let mut chars: Vec<_> = encoder::encode_text(
                &stored,
                &EncodeOptions {
                    packing,
                    integrity: Integrity::None,
                    mask: Some(0),
                    ..Default::default()
                },
            )?
            .chars()
            .collect();
            chars[1] = char::from(b'0' + mode.kind() as u8);
            corrupt.push(json!({"packing":packing.name(),"mode":mode.name(),"text":chars.into_iter().collect::<String>()}));
        }
    }
    let data: Vec<_> = (0..1048576)
        .map(|_| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 24) as u8
        })
        .collect();
    let input = dir.join("random-1MiB.bin");
    fs::write(&input, &data)?;
    let mut large = vec![];
    for packing in names {
        for mode in [Integrity::None, Integrity::Secure] {
            let text = encoder::encode_text(
                &data,
                &EncodeOptions {
                    packing,
                    integrity: mode,
                    mask: Some(0),
                    ..Default::default()
                },
            )?;
            let file = dir.join(format!("large-{}-{}.txt", packing.name(), mode.name()));
            fs::write(&file, &text)?;
            large.push(json!({"packing":packing.name(),"mode":mode.name(),"file":file,"utf8Bytes":text.len(),"nativeBytes":encoder::encode_bytes(&data,&EncodeOptions{packing,integrity:mode,mask:Some(0),..Default::default()})?.len()}));
        }
    }
    let fixture_path = root.join("tests/fixtures/package-packets.json");
    let mut package: serde_json::Value = serde_json::from_slice(&fs::read(&fixture_path)?)?;
    let bytes = from_hex(package["rawHex"].as_str().unwrap())?;
    for p in [Packing::Utf8, Packing::Utf8Compact] {
        for kind in [Integrity::None, Integrity::Fast, Integrity::Secure] {
            package["tagged"][p.name()][kind.name()] = json!(encoder::encode_text(
                &bytes,
                &EncodeOptions {
                    packing: p,
                    integrity: kind,
                    mask: Some(0),
                    ..Default::default()
                }
            )?);
        }
    }
    fs::write(fixture_path, serde_json::to_string_pretty(&package)? + "\n")?;
    fs::write(
        dir.join("vectors.json"),
        serde_json::to_vec(
            &json!({"builds":builds,"rows":rows,"corrupt":corrupt,"large":large,"input":input,"digest":hex(&hash::blake3(&data))}),
        )?,
    )?;
    println!(
        "Prepared {} subsets/profiles and {} integrity/mask vectors",
        builds.len(),
        rows.len()
    );
    Ok(())
}
