//! Prepare archived-decoder experiments with the current native encoder.
//! Original binaries stay under generated/ and are never release/source assets.
use crate::{
    builder::esbuild_path,
    encoder::{self, EncodeOptions, Integrity},
    hash, transport,
};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
fn io<T>(v: std::io::Result<T>) -> Result<T, String> {
    v.map_err(|e| e.to_string())
}
fn random(n: usize, state: &mut u32) -> Vec<u8> {
    (0..n)
        .map(|_| {
            *state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            (*state >> 24) as u8
        })
        .collect()
}
fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320u32.wrapping_mul(crc & 1));
        }
    }
    !crc
}
fn murmur3(data: &[u8]) -> u32 {
    let mut h = 0u32;
    let mut parts = data.chunks_exact(4);
    for p in &mut parts {
        let k = u32::from_le_bytes(p.try_into().unwrap())
            .wrapping_mul(0xcc9e2d51)
            .rotate_left(15)
            .wrapping_mul(0x1b873593);
        h = (h ^ k)
            .rotate_left(13)
            .wrapping_mul(5)
            .wrapping_add(0xe6546b64);
    }
    let tail = parts.remainder();
    let k = tail
        .iter()
        .enumerate()
        .fold(0, |k, (i, &b)| k | (u32::from(b) << (8 * i)));
    if !tail.is_empty() {
        h ^= k
            .wrapping_mul(0xcc9e2d51)
            .rotate_left(15)
            .wrapping_mul(0x1b873593);
    }
    h ^= data.len() as u32;
    h ^= h >> 16;
    h = h.wrapping_mul(0x85ebca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2ae35);
    h ^ (h >> 16)
}
fn write_packets(
    work: &Path,
    id: &str,
    data: &[u8],
    mask: Option<u8>,
    legacy: bool,
) -> Result<Value, String> {
    let mut out = serde_json::Map::new();
    for mode in [Integrity::None, Integrity::Fast, Integrity::Secure] {
        if legacy && mode != Integrity::None {
            continue;
        }
        let file = format!("{id}-{}.utf16", mode.name());
        io(fs::write(
            work.join(&file),
            encoder::dense16(
                data,
                &EncodeOptions {
                    integrity: mode,
                    mask,
                    legacy,
                    ..Default::default()
                },
            )?,
        ))?;
        out.insert(mode.name().into(), json!(file));
    }
    Ok(Value::Object(out))
}
fn compile_hashes(root: &Path, work: &Path) -> Result<(), String> {
    let result = io(Command::new("rustc")
        .args([
            "--edition=2021",
            "--crate-type=cdylib",
            "--target=wasm32v1-none",
            "-Copt-level=3",
            "-Clto=fat",
            "-Cpanic=abort",
            "-Cstrip=symbols",
            "-Clink-arg=-zstack-size=65536",
        ])
        .arg(root.join("benchmarks/fixtures/rust-hashes.rs"))
        .arg("-o")
        .arg(work.join("rust-hashes.wasm"))
        .output())?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into());
    }
    Ok(())
}

/// A manifest may point at the exact original local inputs. Without one, the
/// suite remains reproducible on public deterministic data, including CI.
pub fn prepare(
    root: &Path,
    manifest: Option<&Path>,
    asset_root: Option<&Path>,
    quick: bool,
) -> Result<(), String> {
    let work = root.join("generated/history");
    io(fs::create_dir_all(&work))?;
    super::profiles::build_all(root)?;
    super::fixtures::write_vectors(root)?;
    let mut datasets: Vec<(String, Vec<u8>, Option<Value>)> = Vec::new();
    if let Some(manifest) = manifest {
        let rows: Vec<Value> =
            serde_json::from_slice(&io(fs::read(manifest))?).map_err(|e| e.to_string())?;
        let base = asset_root.unwrap_or(root);
        for row in rows {
            let path = row["binary"]
                .as_str()
                .ok_or("Original input needs binary path")?;
            let data = io(fs::read(base.join(path)))?;
            if row["bytes"].as_u64() != Some(data.len() as u64) {
                return Err("Original input size mismatch".into());
            }
            datasets.push((
                row["label"].as_str().ok_or("Missing label")?.into(),
                data,
                Some(row),
            ));
        }
    }
    let mut state = 833u32;
    for size in if quick {
        vec![128, 65536]
    } else {
        vec![0, 32, 128, 512, 2048, 8192, 32768, 65536, 1048576]
    } {
        for pattern in if size == 0 {
            vec!["empty"]
        } else {
            vec!["zeros", "ones", "sequential", "random"]
        } {
            let data = match pattern {
                "empty" | "zeros" => vec![0; size],
                "ones" => vec![255; size],
                "sequential" => (0..size).map(|i| i as u8).collect(),
                _ => random(size, &mut state),
            };
            datasets.push((format!("{pattern}-{size}"), data, None));
        }
    }
    let mut inputs = Vec::new();
    for (index, (label, data, original)) in datasets.into_iter().enumerate() {
        let id = format!("input-{index}");
        let binary = format!("{id}.bin");
        io(fs::write(work.join(&binary), &data))?;
        let mut adaptive = write_packets(&work, &format!("{id}-adaptive"), &data, None, false)?;
        let fixed = write_packets(&work, &format!("{id}-fixed"), &data, Some(0), false)?;
        let legacy = write_packets(&work, &format!("{id}-legacy"), &data, Some(0), true)?;
        if let Some(row) = &original {
            let base = asset_root.unwrap_or(root);
            for (mode, key) in [("none", "none"), ("fast", "checksum"), ("secure", "secure")] {
                if let Some(path) = row[key].as_str() {
                    let file = format!("{id}-original-{mode}.utf16");
                    io(fs::copy(base.join(path), work.join(&file)))?;
                    adaptive[mode] = json!(file);
                }
            }
        }
        inputs.push(json!({"id":id,"label":label,"bytes":data.len(),"binary":binary,"original":original.is_some(),"expectedSha256":original.as_ref().and_then(|r|r["sha256"].as_str()),"packets":{"adaptive":adaptive,"fixed":fixed,"legacy":legacy["none"]},"crc32":crc32(&data),"murmur3":murmur3(&data),"xxhash32":hash::xxhash32(&data),"blake3":super::fixtures::hex(&hash::blake3(&data))}));
    }
    let mut sources = Vec::new();
    for family in ["guide", "stores", "small-stores", "patterns", "high-digits"] {
        let folder = root.join("benchmarks/experiments/snapshots").join(family);
        let mut files = io(fs::read_dir(folder))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        files.sort_by_key(|e| e.file_name());
        for file in files {
            let path = file.path();
            if path.extension().is_none_or(|e| e != "js") {
                continue;
            }
            let name = path
                .file_stem()
                .unwrap()
                .to_str()
                .ok_or("Non-UTF8 source name")?;
            let (variant, profile) = name.rsplit_once('-').ok_or("Invalid archive name")?;
            sources.push(json!({"id":format!("{family}/{name}"),"family":family,"variant":variant,"profile":profile,"path":path.strip_prefix(root).unwrap()}));
        }
    }
    for name in [
        "float",
        "bigint",
        "registers",
        "per-call",
        "cached-bytes",
        "unchecked-bytes",
        "v1",
        "v2-before-hotloop",
        "v3-monolithic",
    ] {
        sources.push(json!({"id":format!("queues/{name}"),"family":"queues","variant":name,"profile":if name.starts_with("v2")||name=="v3-monolithic"{"full"}else{"legacy"},"path":format!("tests/fixtures/payload-codec-{name}.js")}));
    }
    io(fs::write(
        work.join("manifest.json"),
        serde_json::to_vec_pretty(
            &json!({"schema":1,"quick":quick,"inputs":inputs,"sources":sources}),
        )
        .unwrap(),
    ))?;
    compile_hashes(root, &work)?;
    let mut sizes = Vec::new();
    for name in ["loop", "loop-stop", "unrolled"] {
        let source = io(fs::read(
            root.join(format!("tests/fixtures/blake3-{name}.js")),
        ))?;
        let mut child = io(Command::new(esbuild_path(None))
            .args(["--loader=js", "--minify", "--target=chrome109"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn())?;
        io(child.stdin.take().unwrap().write_all(&source))?;
        let out = io(child.wait_with_output())?;
        if !out.status.success() {
            return Err("Hash minification failed".into());
        }
        sizes.push(json!({"name":format!("blake3-{name}"),"raw":out.stdout.len(),"gzip9":transport::gzip9(&out.stdout)?.len()}));
    }
    let wasm = io(fs::read(
        root.join("generated/wasm/profiles/f01-d012-m01-modern.wasm"),
    ))?;
    let mut xz = io(Command::new("xz")
        .args(["-9e", "--stdout"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn())?;
    io(xz.stdin.take().unwrap().write_all(&wasm))?;
    let compressed = io(xz.wait_with_output())?;
    if !compressed.status.success() {
        return Err("xz failed".into());
    }
    sizes.push(json!({"name":"production-full-wasm","raw":wasm.len(),"gzip9":transport::gzip9(&wasm)?.len(),"xz9e":compressed.stdout.len(),"glyphNoneUtf16le":encoder::dense16(&wasm,&EncodeOptions{integrity:Integrity::None,..Default::default()})?.len(),"glyphSecureUtf16le":encoder::dense16(&wasm,&EncodeOptions::default())?.len()}));
    io(fs::write(
        work.join("sizes.json"),
        serde_json::to_vec_pretty(&sizes).unwrap(),
    ))?;
    println!(
        "{}",
        json!({"historyInputs":inputs.len(),"archiveSources":sources.len(),"originalInputs":inputs.iter().filter(|v|v["original"]==true).count()})
    );
    Ok(())
}

fn decode_base64(text: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut queue, mut bits) = (0u32, 0u32);
    for &c in text {
        let digit = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\r' | b'\n' | b' ' | b'\t' => continue,
            _ => return Err("Invalid fixture Base64".into()),
        };
        queue = (queue << 6) | u32::from(digit);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((queue >> bits) as u8);
        }
    }
    Ok(out)
}
/// Reuse byte-identical historical transport strings when supplied. Current
/// peer code and verifier code still receive fresh fingerprints in the report.
pub fn prepare_peers(
    root: &Path,
    manifest: Option<&Path>,
    asset_root: Option<&Path>,
    quick: bool,
) -> Result<(), String> {
    super::benchmark::prepare(root, quick, &[])?;
    let Some(manifest) = manifest else {
        return Ok(());
    };
    let base = asset_root.unwrap_or(root);
    let old: Vec<Value> =
        serde_json::from_slice(&io(fs::read(manifest))?).map_err(|e| e.to_string())?;
    let work = root.join("generated/encoding-comparison");
    let mut inputs = Vec::new();
    for (index, row) in old.into_iter().enumerate() {
        let label = row["label"].as_str().ok_or("Missing transport label")?;
        let raw = decode_base64(&io(fs::read(
            base.join(
                row["texts"]["none"]["base64"]
                    .as_str()
                    .ok_or("Missing Base64 fixture")?,
            ),
        ))?)?;
        if row["bytes"].as_u64() != Some(raw.len() as u64) {
            return Err("Historical transport size mismatch".into());
        }
        let binary = work.join(format!("historical-{index}.bin"));
        io(fs::write(&binary, &raw))?;
        let mut texts = serde_json::Map::new();
        for mode in ["none", "fast", "secure"] {
            let mut kinds = serde_json::Map::new();
            for kind in ["base64", "base122", "base121", "ascii85", "z85", "bmp"] {
                let source = row["texts"][mode][kind]
                    .as_str()
                    .ok_or("Missing historical encoding")?;
                let destination = work.join(format!("historical-{index}-{mode}.{kind}"));
                io(fs::copy(base.join(source), &destination))?;
                kinds.insert(kind.into(), json!(destination.strip_prefix(root).unwrap()));
            }
            texts.insert(mode.into(), Value::Object(kinds));
        }
        inputs.push(json!({"label":label,"bytes":raw.len(),"binary":binary.strip_prefix(root).unwrap(),"expectedSha256":row["sha256"],"texts":texts}));
    }
    io(fs::write(
        work.join("inputs.json"),
        serde_json::to_vec_pretty(&inputs).unwrap(),
    ))?;
    Ok(())
}

/// Recheck the old expansion examples without conflating payload size with
/// decode speed. Use the archived random bytes when they are available; the
/// other four patterns have a unique deterministic definition.
pub fn pattern_sizes(root: &Path, quick: bool) -> Result<(), String> {
    let work = root.join("generated/history");
    let peers: Vec<Value> = serde_json::from_slice(&io(fs::read(
        root.join("generated/encoding-comparison/inputs.json"),
    ))?)
    .map_err(|e| e.to_string())?;
    let n = if quick { 65536 } else { 1048576 };
    let archived_random = peers
        .iter()
        .find(|v| v["label"] == "random-1MiB" && v["expectedSha256"].is_string() && n == 1048576);
    let mut state = 833;
    let mut rows = Vec::new();
    for pattern in ["zero", "alternating", "sequential", "random", "ff"] {
        let raw = match pattern {
            "zero" => vec![0; n],
            "ff" => vec![255; n],
            "alternating" => (0..n).map(|i| if i % 2 == 0 { 0 } else { 255 }).collect(),
            "sequential" => (0..n).map(|i| i as u8).collect(),
            _ => match archived_random {
                Some(v) => io(fs::read(root.join(v["binary"].as_str().unwrap())))?,
                None => random(n, &mut state),
            },
        };
        for integrity in [Integrity::None, Integrity::Fast, Integrity::Secure] {
            for policy in ["fixed-zero", "sampled", "exact"] {
                let encoded = encoder::dense16(
                    &raw,
                    &EncodeOptions {
                        integrity,
                        mask: (policy == "fixed-zero").then_some(0),
                        effort: if policy == "sampled" {
                            encoder::Effort::Fast
                        } else {
                            encoder::Effort::Full
                        },
                        ..Default::default()
                    },
                )?;
                let first = u16::from_le_bytes(encoded[..2].try_into().unwrap());
                let header = encoder::alphabet().binary_search(&first).unwrap();
                rows.push(json!({"pattern":pattern,"bytes":raw.len(),"integrity":integrity.name(),"policy":policy,"encodedBytesUtf16le":encoded.len(),"mask":header & 255,"overheadPercent":100.0*(encoded.len() as f64/raw.len() as f64-1.0),"originalRandomBytes":pattern=="random"&&archived_random.is_some()}));
            }
        }
    }
    io(fs::write(
        work.join("patterns.json"),
        serde_json::to_vec_pretty(&json!({"rows":rows,"timing":false,"quick":quick})).unwrap(),
    ))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base64_fixtures() {
        for (input, expected) in [
            ("", ""),
            ("Zg==", "f"),
            ("Zm8=", "fo"),
            ("Zm9v", "foo"),
            ("Zm9vYmFy", "foobar"),
        ] {
            assert_eq!(
                decode_base64(input.as_bytes()).unwrap(),
                expected.as_bytes()
            );
        }
        assert!(decode_base64(b"?").is_err());
    }
    #[test]
    fn reference_checksums() {
        assert_eq!(crc32(b"123456789"), 0xcbf43926);
        assert_eq!(murmur3(b""), 0);
        assert_eq!(murmur3(b"foo"), 0xf6a5c420);
        assert_eq!(murmur3(b"hello"), 0x248bfa47);
    }
}
