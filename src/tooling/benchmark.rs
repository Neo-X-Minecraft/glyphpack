//! Native fixture encoders, benchmark preparation and private HTTP hosting.
//! JS browser code owns all decoder timing and V8-specific correctness checks.
use crate::transport::base64;
use crate::{
    builder::esbuild_path,
    encoder::{dense16, Effort, EncodeOptions, Integrity},
    hash::{blake3, xxhash32},
};
use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Component, Path},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

fn io<T>(result: std::io::Result<T>) -> Result<T, String> {
    result.map_err(|e| e.to_string())
}

struct Groups<'a> {
    data: &'a [u8],
    at: usize,
    queue: u32,
    bits: u32,
}
impl Iterator for Groups<'_> {
    type Item = u8;
    fn next(&mut self) -> Option<u8> {
        if self.at == self.data.len() && self.bits == 0 {
            return None;
        }
        while self.bits < 7 && self.at < self.data.len() {
            self.queue = (self.queue << 8) | self.data[self.at] as u32;
            self.at += 1;
            self.bits += 8;
        }
        let value = if self.bits < 7 {
            let v = (self.queue << (7 - self.bits)) & 127;
            self.bits = 0;
            v
        } else {
            self.bits -= 7;
            (self.queue >> self.bits) & 127
        };
        self.queue &= (1 << self.bits) - 1;
        Some(value as u8)
    }
}
fn base122(data: &[u8], html_safe: bool) -> Vec<u8> {
    let illegals = &[0, 10, 13, 34, 38, 92, 60][..if html_safe { 7 } else { 6 }];
    let mut groups = Groups {
        data,
        at: 0,
        queue: 0,
        bits: 0,
    };
    let mut out = Vec::new();
    while let Some(value) = groups.next() {
        if let Some(index) = illegals.iter().position(|&b| b == value) {
            let (index, next) = match groups.next() {
                Some(next) => (index as u8, next),
                None => (7, value),
            };
            out.push(0xc2 | (index << 2) | (next >> 6));
            out.push(0x80 | (next & 63));
        } else {
            out.push(value);
        }
    }
    out
}
fn base85(data: &[u8], z85: bool) -> Vec<u8> {
    const A: &[u8] =
        b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
    let mut out = Vec::new();
    for part in data.chunks(4) {
        let mut word = 0u32;
        for i in 0..4 {
            word = (word << 8) | part.get(i).copied().unwrap_or(0) as u32;
        }
        let mut chars = [0; 5];
        for i in (0..5).rev() {
            let d = (word % 85) as usize;
            word /= 85;
            chars[i] = if z85 { A[d] } else { 33 + d as u8 };
        }
        out.extend_from_slice(&chars[..if part.len() == 4 { 5 } else { part.len() + 1 }]);
    }
    out
}
fn random(size: usize, state: &mut u32) -> Vec<u8> {
    (0..size)
        .map(|_| {
            *state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            (*state >> 24) as u8
        })
        .collect()
}
fn bundle(root: &Path, entry: &Path, out: &Path, defines: &[&str]) -> Result<(), String> {
    let result = io(Command::new(esbuild_path(None))
        .arg(entry)
        .args([
            "--bundle",
            "--format=esm",
            "--target=es2020",
            "--minify",
            "--legal-comments=eof",
        ])
        .args(defines.iter().map(|d| format!("--define:{d}")))
        .arg(format!("--outfile={}", out.display()))
        .current_dir(root)
        .output())?;
    if result.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&result.stderr).into())
    }
}
pub(super) fn browser_sources(root: &Path, work: &Path) -> Result<(), String> {
    let vendor = root.join("benchmarks/vendor/encoding-bench");
    let web = io(fs::read_to_string(
        vendor.join("kevinAlbs-Base122-decode.js"),
    ))?;
    let start = web
        .find("        var strData")
        .ok_or("Base122 reference start missing")?;
    let end = web
        .find("        el.src")
        .ok_or("Base122 reference end missing")?;
    let body = &web[start..end];
    let at = body
        .find("kIllegals")
        .ok_or("Base122 reference alphabet missing")?;
    let reference=format!("export function reference122(strData){{\nvar {}\nreturn decoded.subarray(0,decodedIndex);\n}}\n",&body[at..]);
    io(fs::write(work.join("reference122.mjs"), reference))?;
    let entry="import * as local from '../../benchmarks/fixtures/encoding-competitors.js';\nimport {Base122 as fork} from '../../benchmarks/vendor/encoding-bench/code4fukui-Base122-Base122.js';\nimport * as alttiri from '../../benchmarks/vendor/encoding-bench/AlttiRi-base85-base85.js';\nimport '../../benchmarks/vendor/encoding-bench/Sheep-y-Base85-javascript-base85.js';\nimport {reference122} from './reference122.mjs';\nexport {local,fork,alttiri,reference122};\nexport const sheep=window.Base85;\n";
    io(fs::write(work.join("entry.mjs"), entry))?;
    bundle(
        root,
        &work.join("entry.mjs"),
        &work.join("competitors.mjs"),
        &[],
    )?;
    io(fs::write(work.join("checks-entry.mjs"),"import {verifySelectedData} from '../../tests/reference/decoder/integrity.js';\nexport function verify(bytes,mode){const n=bytes.length-(mode===1?4:32);verifySelectedData(bytes,n,mode);return bytes.subarray(0,n);}\n"))?;
    bundle(
        root,
        &work.join("checks-entry.mjs"),
        &work.join("checks.mjs"),
        &["PAYLOAD_ALLOW_FAST=true", "PAYLOAD_ALLOW_SECURE=true"],
    )
}

/// Prepare deterministic synthetic inputs and optional caller-owned binary files.
/// All built-in data is generated locally; callers can add their own files.
pub fn prepare(root: &Path, quick: bool, extras: &[String]) -> Result<(), String> {
    super::profiles::build_all(root)?;
    let work = root.join("generated/encoding-comparison");
    io(fs::create_dir_all(&work))?;
    browser_sources(root, &work)?;
    let mut rng = 833u32;
    let mut samples = vec![
        (
            "bootstrap".to_string(),
            b"GlyphPack standalone payload fixture.\n".repeat(400),
        ),
        (
            "runtime".to_string(),
            random(if quick { 65536 } else { 4 * 1048576 }, &mut rng),
        ),
        ("random-1KiB".into(), random(1024, &mut rng)),
        ("random-64KiB".into(), random(65536, &mut rng)),
        ("random-1MiB".into(), random(1048576, &mut rng)),
        ("zeros-1MiB".into(), vec![0; 1048576]),
        (
            "sequential-1MiB".into(),
            (0..1048576).map(|i| i as u8).collect(),
        ),
    ];
    for (i, file) in extras.iter().enumerate() {
        samples.push((format!("input-{}", i + 1), io(fs::read(file))?));
    }
    let mut inputs = Vec::new();
    for (label, raw) in samples {
        let path = work.join(format!("{label}.bin"));
        io(fs::write(&path, &raw))?;
        let mut texts = serde_json::Map::new();
        for mode in [Integrity::None, Integrity::Fast, Integrity::Secure] {
            let mut packet = raw.clone();
            match mode {
                Integrity::Fast => packet.extend_from_slice(&xxhash32(&raw).to_le_bytes()),
                Integrity::Secure => packet.extend_from_slice(&blake3(&raw)),
                _ => {}
            }
            let mut fields = serde_json::Map::new();
            let encoded = [
                ("base64", base64(&packet).into_bytes()),
                ("base122", base122(&packet, false)),
                ("base121", base122(&packet, true)),
                ("ascii85", base85(&packet, false)),
                ("z85", base85(&packet, true)),
                (
                    "bmp",
                    dense16(
                        &raw,
                        &EncodeOptions {
                            integrity: mode,
                            effort: if quick { Effort::Fast } else { Effort::Full },
                            ..EncodeOptions::default()
                        },
                    )?,
                ),
            ];
            for (kind, data) in encoded {
                let path = work.join(format!("{label}-{}.{kind}", mode.name()));
                io(fs::write(&path, data))?;
                fields.insert(kind.into(), json!(path.strip_prefix(root).unwrap()));
            }
            texts.insert(mode.name().into(), Value::Object(fields));
        }
        inputs.push(json!({"label":label,"bytes":raw.len(),"binary":path.strip_prefix(root).unwrap(),"texts":texts}));
    }
    io(fs::write(
        work.join("inputs.json"),
        serde_json::to_vec_pretty(&inputs).unwrap(),
    ))?;
    let mut vectors = Vec::new();
    let mut rng = 921u32;
    for n in (0..65).chain([127, 128, 255, 256, 1023, 1024, 4097]) {
        for raw in [
            random(n, &mut rng),
            vec![0; n],
            (0..n).map(|i| i as u8).collect(),
        ] {
            vectors.push(json!({"raw":base64(&raw),"base122":String::from_utf8(base122(&raw,false)).unwrap(),"base121":String::from_utf8(base122(&raw,true)).unwrap(),"ascii85":String::from_utf8(base85(&raw,false)).unwrap(),"z85":String::from_utf8(base85(&raw,true)).unwrap()}));
        }
    }
    io(fs::write(
        work.join("vectors.json"),
        serde_json::to_vec(&vectors).unwrap(),
    ))?;
    println!(
        "{}",
        json!({"prepared":inputs.len(),"vectors":vectors.len(),"quick":quick})
    );
    Ok(())
}

/// An ephemeral localhost origin provides browser modules and SubtleCrypto.
/// Serve this repo only, reject traversal, and stop when the child exits.
fn browser_run(root: &Path, mode: &str) -> Result<(), String> {
    let listener = io(TcpListener::bind(("127.0.0.1", 0)))?;
    let port = io(listener.local_addr())?.port();
    io(listener.set_nonblocking(true))?;
    let stop = Arc::new(AtomicBool::new(false));
    let signal = stop.clone();
    let directory = root.to_path_buf();
    let server = thread::spawn(move || {
        while !signal.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let directory = directory.clone();
                    thread::spawn(move || {
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let mut request = [0; 8192];
                        let Ok(n) = stream.read(&mut request) else {
                            return;
                        };
                        let line = String::from_utf8_lossy(&request[..n]);
                        let path = line
                            .lines()
                            .next()
                            .and_then(|s| s.split_whitespace().nth(1))
                            .unwrap_or("/")
                            .split('?')
                            .next()
                            .unwrap_or("/")
                            .trim_start_matches('/');
                        let relative = Path::new(path);
                        if relative
                            .components()
                            .any(|p| !matches!(p, Component::Normal(_)))
                        {
                            let _=stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                            return;
                        }
                        let file = directory.join(relative);
                        let Ok(body) = fs::read(&file) else {
                            let _=stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                            return;
                        };
                        let mime = match file.extension().and_then(|s| s.to_str()) {
                            Some("js" | "mjs") => "text/javascript; charset=utf-8",
                            Some("json") => "application/json; charset=utf-8",
                            Some("html") => "text/html; charset=utf-8",
                            _ => "application/octet-stream",
                        };
                        let head=format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",body.len());
                        let _ = stream.write_all(head.as_bytes());
                        let _ = stream.write_all(&body);
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(_) => break,
            }
        }
    });
    let status = Command::new("node")
        .arg(root.join(if mode.starts_with("history") {
            "benchmarks/history.cjs"
        } else {
            "benchmarks/run.cjs"
        }))
        .arg(format!("http://127.0.0.1:{port}"))
        .arg(mode)
        .current_dir(root)
        .env("GLYPHPACK_BIN", io(env::current_exe())?)
        .status();
    stop.store(true, Ordering::Relaxed);
    let _ = server.join();
    if io(status)?.success() {
        Ok(())
    } else {
        Err("Browser benchmark failed".into())
    }
}

pub fn run(root: &Path, args: &[String]) -> Result<(), String> {
    let mode = args.first().map(String::as_str).unwrap_or("run");
    let mut quick = false;
    let mut extras = Vec::new();
    let (mut manifest, mut asset_root, mut comparison_manifest) = (None, None, None);
    let mut at = 1;
    while at < args.len() {
        match args[at].as_str() {
            "--quick" => quick = true,
            "--comparison-manifest" => {
                at += 1;
                comparison_manifest = Some(Path::new(
                    args.get(at).ok_or("Missing comparison manifest")?,
                ));
            }
            "--input-manifest" => {
                at += 1;
                manifest = Some(Path::new(args.get(at).ok_or("Missing manifest path")?));
            }
            "--input-root" => {
                at += 1;
                asset_root = Some(Path::new(args.get(at).ok_or("Missing input root")?));
            }
            "--input" => {
                at += 1;
                extras.push(args.get(at).ok_or("Missing input path")?.clone());
            }
            s => return Err(format!("Unknown benchmark option: {s}")),
        }
        at += 1;
    }
    match mode {
        "history" => {
            super::history::prepare(root, manifest, asset_root, quick)?;
            super::history::prepare_peers(root, comparison_manifest, asset_root, quick)?;
            super::history::pattern_sizes(root, quick)?;
            browser_run(root, if quick { "history-smoke" } else { "history" })?;
            super::history_report::write(root)
        }
        "prepare" => prepare(root, quick, &extras),
        "run" | "smoke" => {
            prepare(root, quick || mode == "smoke", &extras)?;
            browser_run(root, mode)
        }
        _ => Err("Expected bench prepare, run, smoke, or history".into()),
    }
}
