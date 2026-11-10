#![allow(dead_code)]
// Paired complete calls against a frozen, generic encoder reference. Fixture
// construction, byte comparison, output hashing and drops are outside timing.
use glyphpack::encoder as new;
use glyphpack::hash;
#[path = "../benchmarks/fixtures/encoder-v0.2.1.rs"]
mod old;
use serde_json::{json, Value};
use std::{
    env,
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
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

fn random(n: usize) -> Vec<u8> {
    let mut seed = 833u32;
    (0..n)
        .map(|_| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 24) as u8
        })
        .collect()
}
fn prepare(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let folder = root.join("generated/encoder-benchmark");
    fs::create_dir_all(&folder)?;
    let mut logs = String::new();
    let mut state = 8123u32;
    while logs.len() < 1048576 {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        writeln!(logs,"{{\"sequence\":{},\"value\":{},\"level\":\"info\",\"message\":\"public benchmark fixture\"}}",logs.len(),state)?;
    }
    let json = logs.into_bytes();
    let log_file = folder.join("json-logs.bin");
    fs::write(&log_file, &json)?;
    let compressed = Command::new("gzip")
        .args(["-9", "-n", "-c"])
        .arg(log_file)
        .output()?;
    if !compressed.status.success() {
        return Err("gzip failed".into());
    }
    let kernel = glyphpack::builder::build_wasm(&glyphpack::builder::BuildOptions::full())
        .map_err(std::io::Error::other)?;
    let unicode = "Hello, 世界. Καλημέρα. Привет. مرحبًا. 🌍\n"
        .repeat(16000)
        .into_bytes();
    let inputs = vec![
        ("empty", Vec::new()),
        ("random-1KiB", random(1024)),
        ("random-64KiB", random(65536)),
        ("random-1MiB", random(1048576)),
        ("random-10MiB", random(10 * 1048576)),
        ("zeros-1MiB", vec![0; 1048576]),
        ("ff-1MiB", vec![255; 1048576]),
        ("sequential-1MiB", (0..1048576).map(|i| i as u8).collect()),
        ("json-logs", json),
        ("gzip-logs", compressed.stdout),
        ("utf8-text", unicode),
        ("decoder-wasm", fs::read(kernel)?),
    ];
    let mut rows = Vec::new();
    for (label, data) in inputs {
        let file = format!("{label}.bin");
        fs::write(folder.join(&file), &data)?;
        rows.push(json!({"label":label,"bytes":data.len(),"binary":format!("generated/encoder-benchmark/{file}"),"blake3":glyphpack::tooling::fixtures::hex(&hash::blake3(&data))}));
    }
    fs::write(
        folder.join("inputs.json"),
        serde_json::to_vec_pretty(&rows)?,
    )?;
    println!("Prepared {} public encoder fixtures", rows.len());
    Ok(())
}
fn bytes(out: Out) -> Vec<u8> {
    match out {
        Out::Bytes(b) => b,
        Out::Wide(b) => b.into_iter().flat_map(u16::to_le_bytes).collect(),
        Out::Text(b) => b.into_bytes(),
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    if args.iter().any(|s| s == "--prepare") {
        return prepare(root);
    }
    let output = args
        .windows(2)
        .find(|a| a[0] == "--output")
        .map(|a| PathBuf::from(&a[1]))
        .unwrap_or_else(|| root.join("generated/results/encoder-paired.json"));
    let manifest = root.join("generated/encoder-benchmark/inputs.json");
    if !manifest.is_file() {
        prepare(root)?
    }
    let inputs: Vec<Value> = serde_json::from_slice(&fs::read(manifest)?)?;
    let quick = args.iter().any(|s| s == "--quick");
    let large = args.iter().any(|s| s == "--large");
    let mut rows = Vec::new();
    for input in inputs {
        let label = input["label"].as_str().unwrap();
        if label == "random-10MiB" && !large {
            continue;
        }
        if quick && !matches!(label, "random-64KiB" | "json-logs") {
            continue;
        }
        let data = fs::read(root.join(input["binary"].as_str().unwrap()))?;
        for policy in 0..3 {
            for mode in 0..3 {
                for backend in 0..3 {
                    if (quick || label == "random-10MiB") && backend != 0 {
                        continue;
                    }
                    let before = bytes(call(0, &data, mode, policy, backend));
                    let after = bytes(call(1, &data, mode, policy, backend));
                    assert_eq!(before, after, "{label}/{mode}/{policy}/{backend}");
                    let fingerprint = glyphpack::tooling::fixtures::hex(&hash::blake3(&after));
                    let output_bytes = after.len();
                    drop(before);
                    drop(after);
                    let mut samples = [Vec::new(), Vec::new()];
                    for round in 0..12 {
                        for step in 0..2 {
                            let which = (round + step) % 2;
                            let start = Instant::now();
                            let out = call(
                                which,
                                black_box(&data),
                                black_box(mode),
                                black_box(policy),
                                black_box(backend),
                            );
                            let elapsed = start.elapsed().as_secs_f64() * 1000.;
                            black_box(&out);
                            if round >= 3 {
                                samples[which].push(elapsed)
                            }
                        }
                    }
                    let centers: Vec<_> = samples
                        .iter()
                        .map(|s| {
                            let mut sorted = s.clone();
                            sorted.sort_by(f64::total_cmp);
                            sorted[4]
                        })
                        .collect();
                    rows.push(json!({"dataset":label,"bytes":data.len(),"integrity":(["none","fast","secure"][mode as usize]),"policy":(["fixed0","sampled","exact"][policy as usize]),"backend":(["utf16le","units","utf8"][backend as usize]),"before_ms":centers[0],"after_ms":centers[1],"speedup":centers[0]/centers[1],"samples":samples,"output_bytes":output_bytes,"output_blake3":fingerprint,"input_blake3":input["blake3"]}));
                }
            }
        }
        println!("Measured {label}");
    }
    fs::create_dir_all(output.parent().unwrap())?;
    let commit = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(root)
        .output()?;
    let source_fingerprints: std::collections::BTreeMap<_, _> = [
        "Cargo.toml",
        "Cargo.lock",
        "src/encoder.rs",
        "src/encoder/parallel.rs",
        "src/hash.rs",
        "benchmarks/fixtures/encoder-v0.2.1.rs",
    ]
    .into_iter()
    .map(|file| {
        Ok((
            file,
            glyphpack::tooling::fixtures::hex(&hash::blake3(&fs::read(root.join(file))?)),
        ))
    })
    .collect::<Result<_, std::io::Error>>()?;
    let report = json!({"schema":1,"kind":"native","rustflags":env::var("RUSTFLAGS").unwrap_or_default(),"sourceFingerprints":source_fingerprints,"rustc":String::from_utf8_lossy(&Command::new("rustc").arg("-Vv").output()?.stdout).trim(),"version":env!("CARGO_PKG_VERSION"),"architecture":env::consts::ARCH,"parallelFeature":cfg!(feature="parallel-encoder"),"logicalCpus":std::thread::available_parallelism().map_or(1,|n|n.get()),"commit":String::from_utf8_lossy(&commit.stdout).trim(),"source_blake3":glyphpack::tooling::fixtures::hex(&hash::blake3(&fs::read(root.join("src/encoder.rs"))?)),"methodology":{"warmups":3,"measured":9,"order":"alternating before/after each round","timed":"complete encoding, selected hash/mask search, fresh output allocation","excluded":"input construction, validation, fingerprinting, output drop","limits":"one process on an unpinned host; individual calls, not batch averages"},"rows":rows});
    fs::write(&output, serde_json::to_vec_pretty(&report)?)?;
    println!(
        "Wrote {} cases to {}",
        report["rows"].as_array().unwrap().len(),
        output.display()
    );
    Ok(())
}
