//! 0BSD, NeoX. Public/synthetic compact-decoder experiment fixtures.
#[path = "../benchmarks/experiments/compact-speed/encode.rs"]
mod candidate;
use glyphpack::{
    encoder::{self, EncodeOptions, Integrity, Packing},
    hash,
    tooling::fixtures::hex,
};
use serde_json::json;
use std::{fs, path::Path};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dir = root.join("generated/compact-speed");
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
        for shift in [23, 25, 27, 30, 31] {
            let (body, state) = candidate::ans(&data, shift);
            let file = dir.join(format!("{name}-ans{shift}.txt"));
            fs::write(&file, &body)?;
            variants.push(json!({"name":format!("ans{shift}"),"file":file,"state":state,"shift":shift,"sourceBytes":body.len()+16}));
        }
        let body = candidate::prefix(&data);
        let file = dir.join(format!("{name}-prefix.txt"));
        fs::write(&file, &body)?;
        variants.push(json!({"name":"prefix","file":file,"sourceBytes":body.len()+10}));
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
        let dense = glyphpack::utf8_compact::encode_enumerative(&data, Some(0))?;
        let dense = format!("\x0e0{dense}");
        let fast = fs::read_to_string(dir.join(format!("{name}-utf8.txt")))?;
        let old = if dense.len() < fast.len() {
            dense
        } else {
            fast
        };
        let legacy = dir.join(format!("{name}-legacy.txt"));
        fs::write(&legacy, &old)?;
        variants.push(json!({"name":"legacy","file":legacy,"sourceBytes":old.len()}));
        rows.push(json!({"name":name,"bytes":size,"input":input,"blake3":hex(&hash::blake3(&data)),"variants":variants}));
    }
    fs::write(dir.join("vectors.json"), serde_json::to_vec(&rows)?)?;
    println!("{} fixtures", rows.len());
    Ok(())
}
