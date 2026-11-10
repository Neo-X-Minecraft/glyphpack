#![allow(dead_code)]
#[path = "../../../src/hash.rs"]
mod hash;
#[path = "../../../src/encoder.rs"]
mod new;
#[path = "../../../generated/encoder-before.rs"]
mod old;
use std::{hint::black_box, time::Instant};
enum Out {
    Wide(Vec<u16>),
    Bytes(Vec<u8>),
    Text(String),
}
fn call(which: usize, data: &[u8], mode: u8, policy: u8, backend: u8) -> Out {
    if which == 0 {
        let options = old::EncodeOptions {
            integrity: match mode {
                0 => old::Integrity::None,
                1 => old::Integrity::Fast,
                _ => old::Integrity::Secure,
            },
            mask: if policy == 0 { Some(0) } else { None },
            effort: if policy == 1 {
                old::Effort::Fast
            } else {
                old::Effort::Full
            },
            legacy: false,
        };
        match backend {
            0 => Out::Bytes(old::dense16(data, &options).unwrap()),
            1 => Out::Wide(old::encode_units(data, &options).unwrap()),
            _ => Out::Text(old::encode_text(data, &options).unwrap()),
        }
    } else {
        let options = new::EncodeOptions {
            integrity: match mode {
                0 => new::Integrity::None,
                1 => new::Integrity::Fast,
                _ => new::Integrity::Secure,
            },
            mask: if policy == 0 { Some(0) } else { None },
            effort: if policy == 1 {
                new::Effort::Fast
            } else {
                new::Effort::Full
            },
            legacy: false,
        };
        match backend {
            0 => Out::Bytes(new::dense16(data, &options).unwrap()),
            1 => Out::Wide(new::encode_units(data, &options).unwrap()),
            _ => Out::Text(new::encode_text(data, &options).unwrap()),
        }
    }
}
fn main() {
    println!("pattern,bytes,mode,policy,backend,old_ms,new_ms,speedup");
    let mut seed = 833u32;
    for size in [65536, 1048576] {
        for pattern in ["zero", "ff", "seq", "random"] {
            let data: Vec<u8> = (0..size)
                .map(|i| match pattern {
                    "zero" => 0,
                    "ff" => 255,
                    "seq" => i as u8,
                    _ => {
                        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                        (seed >> 24) as u8
                    }
                })
                .collect();
            for policy in 0..3 {
                for mode in [0, 2] {
                    for backend in [0, 1] {
                        let bytes = |out: Out| match out {
                            Out::Bytes(v) => v,
                            Out::Wide(v) => v.into_iter().flat_map(u16::to_le_bytes).collect(),
                            Out::Text(v) => v.into_bytes(),
                        };
                        assert_eq!(
                            bytes(call(0, &data, mode, policy, backend)),
                            bytes(call(1, &data, mode, policy, backend))
                        );
                        let mut times = [Vec::new(), Vec::new()];
                        for r in 0..12 {
                            for j in 0..2 {
                                let k = (r + j) % 2;
                                let start = Instant::now();
                                let out = call(
                                    k,
                                    black_box(&data),
                                    black_box(mode),
                                    black_box(policy),
                                    black_box(backend),
                                );
                                let elapsed = start.elapsed().as_secs_f64() * 1000.;
                                black_box(&out);
                                if r >= 3 {
                                    times[k].push(elapsed);
                                }
                            }
                        }
                        for t in &mut times {
                            t.sort_by(f64::total_cmp);
                        }
                        println!(
                            "{pattern},{size},{mode},{policy},{backend},{:.6},{:.6},{:.3}",
                            times[0][4],
                            times[1][4],
                            times[0][4] / times[1][4]
                        );
                    }
                }
            }
        }
    }
}
