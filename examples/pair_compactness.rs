//! 0BSD, NeoX. Size experiments before changing the production pair format.
#[path = "../benchmarks/experiments/template-literals/codec.rs"]
#[allow(dead_code)]
mod literal;
use glyphpack::{
    encoder::{self, Effort, EncodeOptions, Integrity},
    hash,
};
use serde_json::json;
use std::{fs, path::Path};
fn header(n: usize, mode: usize, a: &[u16]) -> Vec<u16> {
    // Example only: use the unused kind=3 space to fit 40 tiny lengths, then
    // keep two-symbol headers through 40+41*R. Unallocated codes stay reserved.
    let r = a.len();
    if n < 40 {
        vec![a[n * 768 + mode]]
    } else if n < 40 + 41 * r {
        let v = n - 40;
        vec![a[30720 + (v / r) * 768 + mode], a[v % r]]
    } else {
        vec![a[62208 + mode], a[n % r], a[n / r]]
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = Path::new("generated/pair-compactness");
    fs::create_dir_all(dir)?;
    let a = encoder::alphabet();
    let wide = &literal::profiles()[2].alphabet;
    let mut output = Vec::new();
    // Self-contained, deterministic fixtures; no earlier generated manifest
    // or private files are needed to reproduce this source-size experiment.
    let mut cases = Vec::new();
    for n in (0..16).chain([31, 32, 33, 39, 40, 41, 1024, 65536, 1048576, 10485760]) {
        let mut seed = 815u32;
        let random: Vec<_> = (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 24) as u8
            })
            .collect();
        cases.push((format!("random-{n}"), random));
        if n >= 1024 {
            cases.push((format!("zero-{n}"), vec![0; n]));
            cases.push((format!("ff-{n}"), vec![255; n]));
        }
    }
    for (dataset, data) in cases {
        for (kind, integrity) in [Integrity::None, Integrity::Fast, Integrity::Secure]
            .into_iter()
            .enumerate()
        {
            let mut stored = data.clone();
            match integrity {
                Integrity::Fast => stored.extend(hash::xxhash32(&data).to_le_bytes()),
                Integrity::Secure => stored.extend(hash::blake3(&data)),
                _ => (),
            }
            let mut p = encoder::encode_units(
                &data,
                &EncodeOptions {
                    integrity,
                    effort: Effort::Fast,
                    ..Default::default()
                },
            )?;
            // Keep this study's immutable format-3 baseline after format 4 ships.
            if p.first() == Some(&glyphpack::packing::PAIR_TAG) {
                p.remove(0);
            }
            let mask = (a.binary_search(&p[0]).unwrap() & 255) as u8;
            let old_header = if stored.len() < 32 * a.len() { 2 } else { 3 };
            let tail = usize::from(p.len() > old_header && p.last() == Some(&a[0]));
            // The independently written reference packer must agree before using
            // its widened alphabet. Its helper initially writes kind=secure.
            let mut reference = literal::pack(&stored, mask, a);
            let h = a.binary_search(&reference[0]).unwrap();
            reference[0] = a[h - 512 + kind * 256];
            assert_eq!(reference, p);
            let w = literal::pack(&stored, mask, wide);
            let small_header = header(stored.len(), mask as usize + kind * 256, a);
            output.push(json!({"dataset":dataset,"bytes":data.len(),"kind":kind,"currentBytes":p.len()*2,"taggedBytes":(p.len()+1)*2,"tailBytes":(p.len()+1-tail)*2,"compactHeaderBytes":(p.len()+1-old_header+small_header.len())*2,"bothBytes":(p.len()+1-old_header+small_header.len()-tail)*2,"wideBytes":(w.len()+1)*2,"mask":mask,"storedBlake3":glyphpack::tooling::fixtures::hex(&hash::blake3(&stored))}));
        }
    }
    let mut csv=String::from("dataset,input_bytes,integrity,current_bytes,with_tag_bytes,trim_tail_bytes,tiny_header_bytes,both_bytes,wide_alphabet_bytes\n");
    use std::fmt::Write as _;
    for r in &output {
        writeln!(
            csv,
            "{},{},{},{},{},{},{},{},{}",
            r["dataset"].as_str().unwrap(),
            r["bytes"],
            ["none", "fast", "secure"][r["kind"].as_u64().unwrap() as usize],
            r["currentBytes"],
            r["taggedBytes"],
            r["tailBytes"],
            r["compactHeaderBytes"],
            r["bothBytes"],
            r["wideBytes"]
        )?;
    }
    fs::write(dir.join("sizes.csv"), csv)?;
    fs::write(
        dir.join("sizes.json"),
        serde_json::to_vec_pretty(
            &json!({"rows":output,"scope":"source bytes only; new candidates include a one-code-unit codec indicator; mask held constant; no decoder cost included"}),
        )?,
    )?;
    println!(
        "Checked {} paired/reference packets; wrote source-size options",
        output.len()
    );
    Ok(())
}
