//! 0BSD, NeoX. Current-format synthetic fixtures for compact performance tests.
use glyphpack::{
    encoder::{self, EncodeOptions, Integrity, Packing},
    hash,
    tooling::fixtures::hex,
};
use serde_json::json;
use std::{fs, path::Path};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("generated/compact-speed");
    fs::create_dir_all(&dir)?;
    let mut rows = vec![];
    let mut seed = 815u32;
    for (name, size, fill) in [
        ("random-1KiB", 1024, None),
        ("random-64KiB", 65536, None),
        ("random-1MiB", 1048576, None),
        ("zeros-1MiB", 1048576, Some(0)),
        ("ff-1MiB", 1048576, Some(255)),
    ] {
        let data: Vec<_> = (0..size)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                fill.unwrap_or((seed >> 24) as u8)
            })
            .collect();
        let input = dir.join(format!("{name}.bin"));
        fs::write(&input, &data)?;
        let mut variants = vec![];
        for packing in [Packing::Utf8, Packing::Utf8Compact] {
            let text = encoder::encode_text(
                &data,
                &EncodeOptions {
                    packing,
                    integrity: Integrity::None,
                    mask: Some(0),
                    ..Default::default()
                },
            )?;
            let file = dir.join(format!("{name}-{}.txt", packing.name()));
            fs::write(&file, &text)?;
            variants.push(json!({"name":packing.name(),"file":file,"sourceBytes":text.len()}));
        }
        rows.push(json!({"name":name,"bytes":size,"input":input,"blake3":hex(&hash::blake3(&data)),"variants":variants}));
    }
    fs::write(dir.join("vectors.json"), serde_json::to_vec(&rows)?)?;
    println!("{} current-format fixtures", rows.len());
    Ok(())
}
