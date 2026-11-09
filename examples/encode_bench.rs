//! Native encoder benchmark; decoder timings belong to the Chromium benchmark.
use glyphpack::encoder::{dense16, EncodeOptions, Integrity};
use std::{hint::black_box, time::Instant};
fn main() {
    let size = 262144;
    let mut seed = 833u32;
    let patterns = [
        ("zero", vec![0; size]),
        ("ff", vec![255; size]),
        ("sequential", (0..size).map(|i| i as u8).collect()),
        (
            "random",
            (0..size)
                .map(|_| {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    (seed >> 24) as u8
                })
                .collect(),
        ),
    ];
    println!("pattern,bytes,integrity,mask_policy,median_ms,output_bytes");
    for (pattern, data) in patterns {
        for integrity in [Integrity::None, Integrity::Fast, Integrity::Secure] {
            for mask in [Some(0), None] {
                let options = EncodeOptions {
                    integrity,
                    mask,
                    ..EncodeOptions::default()
                };
                let mut times = Vec::new();
                let mut length = 0;
                for round in 0..7 {
                    let start = Instant::now();
                    let out = dense16(black_box(&data), black_box(&options)).unwrap();
                    length = out.len();
                    black_box(&out);
                    if round >= 2 {
                        times.push(start.elapsed().as_secs_f64() * 1000.0);
                    }
                }
                times.sort_by(f64::total_cmp);
                println!(
                    "{pattern},{size},{},{},{:.6},{length}",
                    integrity.name(),
                    if mask.is_none() { "adaptive" } else { "fixed0" },
                    times[2]
                );
            }
        }
    }
}
