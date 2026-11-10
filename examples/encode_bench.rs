//! Reproducible native encoder measurements. All input construction, digest
//! correctness checks and JSON/CSV serialization happen outside the timed calls.
use glyphpack::{
    encoder::{dense16, encode_text, encode_units, Effort, EncodeOptions, Integrity},
    hash::blake3,
    tooling::fixtures::hex,
};
use serde_json::json;
use std::{env, fs, hint::black_box, process::Command, time::Instant};

fn median(samples: &mut [f64]) -> f64 {
    samples.sort_by(f64::total_cmp);
    (samples[(samples.len() - 1) / 2] + samples[samples.len() / 2]) / 2.0
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), String> {
    let args: Vec<_> = env::args().skip(1).collect();
    let quick = args.iter().any(|a| a == "--quick");
    let output = args
        .windows(2)
        .find(|a| a[0] == "--output")
        .map(|a| a[1].clone());
    let sizes: &[usize] = if quick {
        &[4096, 262144]
    } else {
        &[1024, 65536, 1048576]
    };
    let backends: &[&str] = if quick {
        &["utf16le"]
    } else {
        &["utf16le", "units", "text"]
    };
    let mut rows = Vec::new();
    let mut seed = 833u32;
    for &size in sizes {
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
        for (pattern, data) in patterns {
            for integrity in [Integrity::None, Integrity::Fast, Integrity::Secure] {
                // Rotate policy order between rounds so all expensive mask searches
                // cannot systematically run after/before the same alternative.
                let policies = [
                    ("fixed0", Some(0), Effort::Full),
                    ("sampled", None, Effort::Fast),
                    ("full", None, Effort::Full),
                ];
                for &backend in backends {
                    let mut samples: [Vec<f64>; 3] = Default::default();
                    let mut lengths = [0; 3];
                    let mut digests: [String; 3] = Default::default();
                    for round in 0..12 {
                        for step in 0..3 {
                            let index = (step + round) % 3;
                            let (_, mask, effort) = policies[index];
                            let options = EncodeOptions {
                                integrity,
                                mask,
                                effort,
                                ..EncodeOptions::default()
                            };
                            let start = Instant::now();
                            // Black-box input/options and consume the actual buffer.
                            // Drop is outside the interval, matching browser allocation
                            // measurements without pretending to control GC behavior.
                            let (elapsed, length, digest) = match backend {
                                "utf16le" => {
                                    let out = dense16(black_box(&data), black_box(&options))?;
                                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                                    black_box(&out);
                                    let digest = if round == 0 {
                                        hex(&blake3(&out))
                                    } else {
                                        String::new()
                                    };
                                    (elapsed, out.len(), digest)
                                }
                                "units" => {
                                    let out = encode_units(black_box(&data), black_box(&options))?;
                                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                                    black_box(&out);
                                    let digest = if round == 0 {
                                        hex(&blake3(
                                            &out.iter()
                                                .flat_map(|v| v.to_le_bytes())
                                                .collect::<Vec<_>>(),
                                        ))
                                    } else {
                                        String::new()
                                    };
                                    (elapsed, out.len() * 2, digest)
                                }
                                _ => {
                                    let out = encode_text(black_box(&data), black_box(&options))?;
                                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                                    black_box(&out);
                                    let digest = if round == 0 {
                                        hex(&blake3(out.as_bytes()))
                                    } else {
                                        String::new()
                                    };
                                    (elapsed, out.len(), digest)
                                }
                            };
                            lengths[index] = length;
                            if round == 0 {
                                digests[index] = digest;
                            }
                            if round >= 3 {
                                samples[index].push(elapsed);
                            }
                        }
                    }
                    for (index, (policy, _, _)) in policies.iter().enumerate() {
                        let mut sorted = samples[index].clone();
                        let time = median(&mut sorted);
                        rows.push(json!({"pattern":pattern,"bytes":size,"integrity":integrity.name(),"policy":policy,"backend":backend,"median_ms":time,"min_ms":sorted[0],"max_ms":sorted[8],"output_bytes":lengths[index],"output_blake3":digests[index],"samples_ms":samples[index]}));
                    }
                }
            }
        }
    }
    let command = |program, args: &[&str]| {
        Command::new(program)
            .args(args)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    let report = json!({"schema":1,"version":env!("CARGO_PKG_VERSION"),"commit":command("git",&["rev-parse","HEAD"]),"rustc":command("rustc",&["-Vv"]),"os":env::consts::OS,"architecture":env::consts::ARCH,"logical_cpus":std::thread::available_parallelism().map(|n|n.get()).unwrap_or(0),"cpu_info":fs::read_to_string("/proc/cpuinfo").unwrap_or_default(),"rustflags":env::var("RUSTFLAGS").unwrap_or_default(),"methodology":{"timed":"input bytes to new encoded buffer; selected hash and mask search included","excluded":"input construction, output hashing, serialization and buffer drop","warmups":3,"measured":9,"order":"three policies rotate each round","limits":"single process and host; no affinity, frequency or temperature control"},"rows":rows});
    println!("pattern,bytes,integrity,mask_policy,backend,median_ms,min_ms,max_ms,output_bytes");
    for row in report["rows"].as_array().unwrap() {
        println!(
            "{},{},{},{},{},{:.6},{:.6},{:.6},{}",
            row["pattern"].as_str().unwrap(),
            row["bytes"],
            row["integrity"].as_str().unwrap(),
            row["policy"].as_str().unwrap(),
            row["backend"].as_str().unwrap(),
            row["median_ms"].as_f64().unwrap(),
            row["min_ms"].as_f64().unwrap(),
            row["max_ms"].as_f64().unwrap(),
            row["output_bytes"]
        );
    }
    if let Some(output) = output {
        fs::write(output, serde_json::to_vec_pretty(&report).unwrap())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
