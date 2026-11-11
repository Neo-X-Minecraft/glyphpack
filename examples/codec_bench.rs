//! 0BSD, NeoX. Prepare deterministic, nonprivate production-codec measurements.
//! Timings live in benchmarks/codecs.cjs; native preparation is never timed.
use glyphpack::{
    encoder::{self, Effort, EncodeOptions, Integrity, Packing},
    hash,
    tooling::fixtures::hex,
};
use serde_json::json;
use std::{fs, path::Path};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = Path::new("generated/codec-bench");
    fs::create_dir_all(dir)?;
    let mut rows = Vec::new();
    for n in [1024, 65536, 1048576, 10485760] {
        let mut seed = 815u32;
        let data: Vec<_> = (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 24) as u8
            })
            .collect();
        for integrity in [Integrity::None, Integrity::Fast, Integrity::Secure] {
            for packing in [Packing::Pair, Packing::Ans, Packing::Windows] {
                let options = EncodeOptions {
                    packing,
                    integrity,
                    effort: Effort::Fast,
                    ..Default::default()
                };
                let text = encoder::encode_text(&data, &options)?;
                // A common UTF-16 fixture container keeps loading outside the
                // measurement. Report native source size separately, including
                // each packet's codec indicator, header, states and digest.
                let file = dir.join(format!("{n}-{}-{}.utf16", packing.name(), integrity.name()));
                fs::write(
                    &file,
                    text.encode_utf16()
                        .flat_map(u16::to_le_bytes)
                        .collect::<Vec<_>>(),
                )?;
                rows.push(json!({"packing":packing.name(),"integrity":integrity.name(),"bytes":n,"sourceBytes":text.encode_utf16().count()*if packing==Packing::Windows{1}else{2},"file":file,"blake3":hex(&hash::blake3(&data))}));
            }
        }
    }
    fs::write(
        dir.join("manifest.json"),
        serde_json::to_vec_pretty(
            &json!({"seed":815,"maskSearch":"sampled pair-score heuristic","rows":rows}),
        )?,
    )?;
    Ok(())
}
