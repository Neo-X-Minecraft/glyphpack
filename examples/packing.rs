//! Local packing trials only: compile isolated kernels, generate public fixtures
//! and own-output browser modules. Production files and wire format stay intact.
#[path = "../benchmarks/experiments/packing/core.rs"]
mod core;
#[path = "../benchmarks/experiments/packing/encode.rs"]
mod encode;
#[path = "../benchmarks/experiments/template-literals/codec.rs"]
#[allow(dead_code)]
mod literal;
#[path = "../benchmarks/experiments/packing/report.rs"]
mod report;
use glyphpack::{
    encoder, hash,
    transport::{base64, gzip9},
};
use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
const DIR: &str = "generated/packing";
const SRC: &str = "benchmarks/experiments/packing";
const NAMES: [&str; 7] = [
    "pair16", "group32", "group48", "group64", "block703", "ans1", "ans4",
];
fn run(c: &mut Command) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let r = c.output()?;
    if !r.status.success() {
        return Err(String::from_utf8_lossy(&r.stderr).into_owned().into());
    }
    Ok(r.stdout)
}
fn compile(
    source: &Path,
    name: &str,
    method: u32,
    radix: u32,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let raw = Path::new(DIR).join(format!("{name}.raw.wasm"));
    let wasm = Path::new(DIR).join(format!("{name}.wasm"));
    run(Command::new("rustc")
        .args([
            "--edition=2021",
            "--crate-type=cdylib",
            "--target=wasm32v1-none",
            "-Copt-level=3",
            "-Clto=fat",
            "-Cpanic=abort",
            "-Cstrip=symbols",
            "-Ctarget-feature=+simd128",
            "-Clink-arg=-zstack-size=65536",
        ])
        .env("PACKING_METHOD", method.to_string())
        .env("PACKING_RADIX", radix.to_string())
        .arg(source)
        .arg("-o")
        .arg(&raw))?;
    run(Command::new("node_modules/.bin/wasm-opt")
        .arg(&raw)
        .args([
            "--mvp-features",
            "--enable-mutable-globals",
            "--enable-simd",
            "-O4",
            "--converge",
            "--vacuum",
            "--strip-dwarf",
            "--strip-producers",
            "-o",
        ])
        .arg(&wasm))?;
    Ok(wasm)
}
fn bundle(
    entry: &Path,
    out: &Path,
    defines: &[(&str, String)],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = Command::new(glyphpack::builder::esbuild_path(None));
    cmd.arg(entry)
        .args([
            "--bundle",
            "--format=esm",
            "--target=chrome109",
            "--minify",
            "--legal-comments=none",
        ])
        .arg(format!("--outfile={}", out.display()));
    for (k, v) in defines {
        cmd.arg(format!("--define:{k}={v}"));
    }
    run(&mut cmd)?;
    Ok(())
}
fn wasm_literal(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    Ok(format!(
        "{:?}",
        base64(&gzip9(&fs::read(path)?).map_err(std::io::Error::other)?)
    ))
}
fn build() -> Result<Value, Box<dyn std::error::Error>> {
    fs::create_dir_all(DIR)?;
    let root = fs::canonicalize(".")?;
    let hash = compile(Path::new(SRC).join("kernel.rs").as_path(), "hash", 99, 254)?;
    let hash_payload = wasm_literal(&hash)?;
    let mut rows = Vec::new();
    for radix in [254, 253] {
        for method in 0..7 {
            if radix == 253 && !matches!(method, 1 | 6) {
                continue;
            }
            let kernel = compile(
                Path::new(SRC).join("kernel.rs").as_path(),
                &format!("r{radix}-{}", NAMES[method as usize]),
                method,
                radix,
            )?;
            for backend in 0..if radix == 254 && matches!(method, 1 | 6) {
                4
            } else {
                3
            } {
                let label = format!(
                    "r{radix}-{}-{}",
                    NAMES[method as usize],
                    ["js", "wasm16", "wasm8", "wasm-utf8"][backend]
                );
                let module = Path::new(DIR).join(format!("{label}.mjs"));
                let payload = if backend == 0 {
                    hash_payload.clone()
                } else {
                    wasm_literal(&kernel)?
                };
                bundle(
                    &Path::new(SRC).join("byte.js"),
                    &module,
                    &[
                        ("WASM_B64", payload),
                        ("PACK_RADIX", radix.to_string()),
                        ("PACK_METHOD", method.to_string()),
                        ("PACK_BACKEND", backend.to_string()),
                    ],
                )?;
                rows.push(json!({"name":label,"packet":format!("r{radix}-{}",NAMES[method as usize]),"module":module,"method":method,"radix":radix,"backend":backend,"kernel":if backend==0{&hash}else{&kernel},"encoding":"windows-1252","context":if radix==253{"Cooked"}else{"Tagged"}}));
            }
        }
    }
    for (method, name) in [(6, "ans4"), (8, "ans16x4"), (9, "ans16x4precise")] {
        let kernel = compile(
            &Path::new(SRC).join("kernel.rs"),
            &format!("wide-{name}"),
            method,
            63484,
        )?;
        for backend in 0..if method == 9 { 4 } else { 2 } {
            if backend == 2 {
                continue;
            }
            let label = format!(
                "wide-{name}-{}",
                if backend == 0 {
                    "js"
                } else if backend == 3 {
                    "wasm-utf8"
                } else {
                    "wasm16"
                }
            );
            let module = Path::new(DIR).join(format!("{label}.mjs"));
            bundle(
                &Path::new(SRC).join("byte.js"),
                &module,
                &[
                    (
                        "WASM_B64",
                        if backend == 0 {
                            hash_payload.clone()
                        } else {
                            wasm_literal(&kernel)?
                        },
                    ),
                    ("PACK_RADIX", "63484".into()),
                    ("PACK_METHOD", method.to_string()),
                    ("PACK_BACKEND", backend.to_string()),
                ],
            )?;
            rows.push(json!({"name":label,"packet":format!("wide-{name}"),"module":module,"method":method,"radix":63484,"backend":backend,"kernel":if backend==0{&hash}else{&kernel},"encoding":"utf-16le","context":"Cooked"}));
        }
    }
    // Build the widened UTF-16 reference from copies of production sources. Its
    // hot loop, verifier, ABI and optimization flags remain the production ones.
    let work = Path::new(DIR).join("wide-source");
    fs::create_dir_all(&work)?;
    let mut lib = fs::read_to_string("crates/decoder-wasm/src/lib.rs")?.replace(
        "../../../src/hash.rs",
        &root.join("src/hash.rs").display().to_string(),
    );
    let begin = lib.find("        for c in 32..65534 {").unwrap();
    let end = begin + lib[begin..].find("            index += 1;").unwrap();
    lib.replace_range(begin..end,"        for c in 0..65536 {\n            if [0,13,92,96].contains(&c)||(55296..=57343).contains(&c){continue}\n");
    for (a, b) in [("63384", "63483"), ("63385", "63484"), ("63386", "63485")] {
        lib = lib.replace(a, b);
    }
    fs::write(work.join("lib.rs"), lib)?;
    let mut unpack = fs::read_to_string("crates/decoder-wasm/src/unpack.rs")?;
    for (a, b) in [("63384", "63483"), ("63385", "63484"), ("63386", "63485")] {
        unpack = unpack.replace(a, b);
    }
    unpack = unpack.replace("1870174576", &(63484u64 * 63484 - 2147483649).to_string());
    fs::write(work.join("unpack.rs"), unpack)?;
    let raw = Path::new(DIR).join("wide.raw.wasm");
    let kernel = Path::new(DIR).join("wide.wasm");
    let mut cmd = Command::new("rustc");
    cmd.args([
        "--edition=2021",
        "--crate-type=cdylib",
        "--target=wasm32v1-none",
        "-Copt-level=3",
        "-Clto=fat",
        "-Cpanic=abort",
        "-Cstrip=symbols",
        "-Ctarget-feature=+simd128",
        "-Clink-arg=-zstack-size=65536",
    ]);
    for feature in ["format", "format-runtime", "none", "fast", "secure"] {
        cmd.arg("--cfg").arg(format!("feature={feature:?}"));
    }
    run(cmd.arg(work.join("lib.rs")).arg("-o").arg(&raw))?;
    run(Command::new("node_modules/.bin/wasm-opt")
        .arg(&raw)
        .args([
            "--mvp-features",
            "--enable-mutable-globals",
            "--enable-simd",
            "-O4",
            "--converge",
            "-o",
        ])
        .arg(&kernel))?;
    let host = fs::read_to_string("src/decoder/wasm-runtime.js")?
        .replace("PAYLOAD_INCLUDE_FORMAT", "true")
        .replace("PAYLOAD_CHECK_DATA", "true")
        .replace("PAYLOAD_ALLOW_FAST", "true")
        .replace("PAYLOAD_ALLOW_SECURE", "true");
    let loader = root.join("src/decoder/loader.js");
    let wide_entry = Path::new(DIR).join("wide-entry.js");
    fs::write(&wide_entry,format!("import{{loadWasm}}from{:?};\n{host}\nconst api=await loadWasm({});export function binary(t,m=2){{return runWasm(api,t,true,m,false)}}export function memory(){{return api.memory.buffer.byteLength}}",loader,wasm_literal(&kernel)?))?;
    bundle(&wide_entry, &Path::new(DIR).join("wide-wasm.mjs"), &[])?;
    rows.push(json!({"name":"wide-wasm","packet":"wide","module":format!("{DIR}/wide-wasm.mjs"),"method":-1,"radix":63484,"backend":1,"kernel":kernel,"encoding":"utf-16le","context":"Cooked"}));
    for (name, entry, packet, encoding, context) in [
        ("wide-js", "wide.js", "wide", "utf-16le", "Cooked"),
        ("base64-native", "base64.js", "base64", "utf-8", "Cooked"),
    ] {
        let module = Path::new(DIR).join(format!("{name}.mjs"));
        bundle(
            &Path::new(SRC).join(entry),
            &module,
            &[("WASM_B64", hash_payload.clone())],
        )?;
        rows.push(json!({"name":name,"packet":packet,"module":module,"method":-1,"radix":0,"backend":0,"kernel":hash,"encoding":encoding,"context":context}));
    }
    let old_entry = Path::new(DIR).join("production-entry.js");
    fs::write(&old_entry,format!("import{{binary as original}}from{:?};export function binary(t,m=2){{return original(t,{{verifyFormat:true,verifyData:['none','fast','secure'][m],memoryHeavy:false}})}}export function memory(){{return null}}",root.join("dist/full.min.mjs")))?;
    bundle(&old_entry, &Path::new(DIR).join("production.mjs"), &[])?;
    rows.push(json!({"name":"production","packet":"production","module":format!("{DIR}/production.mjs"),"method":-1,"radix":63385,"backend":1,"encoding":"utf-16le","context":"RawText"}));
    for row in &mut rows {
        let path = row["module"].as_str().unwrap();
        let module = fs::read(path)?;
        row["moduleBytes"] = json!(module.len());
        row["moduleGzipBytes"] = json!(gzip9(&module).map_err(std::io::Error::other)?.len());
        row["moduleBlake3"] = json!(glyphpack::tooling::fixtures::hex(&hash::blake3(&module)));
    }
    Ok(json!(rows))
}
fn stored(data: &[u8], kind: u8) -> Vec<u8> {
    let mut out = data.to_vec();
    if kind == 1 {
        out.extend(hash::xxhash32(data).to_le_bytes())
    }
    if kind == 2 {
        out.extend(hash::blake3(data))
    }
    out
}
fn native_check(data: &[u8], packet: &[u8], method: u32, radix: u32, mask: u8) {
    let mut out = vec![0; data.len()];
    core::decode(
        &mut core::Slice {
            data: &packet[6..],
            at: 0,
            radix,
        },
        &mut out,
        mask,
        radix,
        method,
    )
    .unwrap();
    assert_eq!(out, data);
}
fn prepare(builds: Value) -> Result<(), Box<dyn std::error::Error>> {
    let entries: Vec<Value> =
        serde_json::from_slice(&fs::read("generated/encoder-benchmark/inputs.json")?)?;
    let profiles = literal::profiles();
    let mut rows = Vec::new();
    for entry in entries {
        let label = entry["label"].as_str().unwrap();
        let data = fs::read(entry["binary"].as_str().unwrap())?;
        for kind in 0..3u8 {
            let bytes = stored(&data, kind);
            let expected = format!("{DIR}/{label}-{kind}.bin");
            fs::write(&expected, &bytes)?;
            let mut packets = serde_json::Map::new();
            for radix in [254, 253] {
                let alphabet = &profiles[if radix == 254 { 11 } else { 10 }].alphabet;
                let context = if radix == 254 {
                    literal::Context::Tagged
                } else {
                    literal::Context::Cooked
                };
                for method in 0..7 {
                    if radix == 253 && !matches!(method, 1 | 6) {
                        continue;
                    }
                    let mut best = None;
                    for mask in [0, 255] {
                        let p = encode::pack(&bytes, mask, kind, method, radix);
                        native_check(&bytes, &p, method, radix, mask);
                        let units: Vec<_> = p.iter().map(|&d| alphabet[d as usize]).collect();
                        let cost = literal::source(&units, context).len();
                        if best.as_ref().is_none_or(|(_, old, _)| cost < *old) {
                            best = Some((units, cost, mask));
                        }
                    }
                    let (units, cost, mask) = best.unwrap();
                    let name = format!("r{radix}-{}", NAMES[method as usize]);
                    let path = format!("{DIR}/{label}-{kind}-{name}.u16");
                    fs::write(
                        &path,
                        units
                            .iter()
                            .flat_map(|u| u.to_le_bytes())
                            .collect::<Vec<_>>(),
                    )?;
                    packets.insert(name,json!({"text":path,"sourceBytes":cost,"mask":mask,"units":units.len(),"maskPolicy":"best of 0 and 255"}));
                }
            }
            let options = encoder::EncodeOptions {
                integrity: [
                    encoder::Integrity::None,
                    encoder::Integrity::Fast,
                    encoder::Integrity::Secure,
                ][kind as usize],
                ..Default::default()
            };
            let old = encoder::encode_units(&data, &options)?;
            for (method, name) in [(6, "ans4"), (8, "ans16x4"), (9, "ans16x4precise")] {
                let alphabet = &profiles[3].alphabet;
                let mut best = None;
                for mask in [0, 255] {
                    let digits = encode::pack_wide(&bytes, mask, kind, method);
                    let mut decoded = vec![0; bytes.len()];
                    core::decode(
                        &mut core::Words {
                            data: &digits[3..],
                            at: 0,
                            radix: 63484,
                        },
                        &mut decoded,
                        mask,
                        63484,
                        method,
                    )
                    .unwrap();
                    assert_eq!(decoded, bytes);
                    let units: Vec<_> = digits.iter().map(|&d| alphabet[d as usize]).collect();
                    let cost = literal::cooked(&units).len() * 2;
                    if best.as_ref().is_none_or(|(_, old, _)| cost < *old) {
                        best = Some((units, cost, mask))
                    }
                }
                let (units, cost, mask) = best.unwrap();
                let name = format!("wide-{name}");
                let path = format!("{DIR}/{label}-{kind}-{name}.u16");
                fs::write(
                    &path,
                    units
                        .iter()
                        .flat_map(|u| u.to_le_bytes())
                        .collect::<Vec<_>>(),
                )?;
                packets.insert(name,json!({"text":path,"sourceBytes":cost,"mask":mask,"units":units.len(),"maskPolicy":"best of 0 and 255"}));
            }
            for (name, units, context) in [
                ("production", old, literal::Context::RawText),
                (
                    "wide",
                    {
                        let mut best = None;
                        for mask in [0, 255] {
                            let mut p = literal::pack(&bytes, mask, &profiles[3].alphabet);
                            let h = profiles[3]
                                .alphabet
                                .iter()
                                .position(|&c| c == p[0])
                                .unwrap();
                            p[0] = profiles[3].alphabet[h - 512 + kind as usize * 256];
                            let cost = literal::cooked(&p).len();
                            if best.as_ref().is_none_or(|(_, old)| cost < *old) {
                                best = Some((p, cost));
                            }
                        }
                        best.unwrap().0
                    },
                    literal::Context::Cooked,
                ),
                (
                    "base64",
                    base64(&bytes).encode_utf16().collect(),
                    literal::Context::Cooked,
                ),
            ] {
                let cost =
                    literal::source(&units, context).len() * if name == "base64" { 1 } else { 2 };
                let path = format!("{DIR}/{label}-{kind}-{name}.u16");
                fs::write(
                    &path,
                    units
                        .iter()
                        .flat_map(|u| u.to_le_bytes())
                        .collect::<Vec<_>>(),
                )?;
                packets.insert(
                    name.into(),
                    json!({"text":path,"sourceBytes":cost,"units":units.len()}),
                );
            }
            rows.push(json!({"dataset":label,"bytes":data.len(),"kind":kind,"expected":expected,"packets":packets}));
        }
        println!("Prepared {label}");
    }
    let report = json!({"schema":1,"variants":builds,"rows":rows,"maskPolicy":"byte and widened-BMP candidates: best of 0/255; production: full default search","fingerprints":"Module bytes and BLAKE3; browser adds SHA-256","rustc":String::from_utf8_lossy(&run(Command::new("rustc").arg("-Vv"))?),"sizeScope":"Escaped source with headers/trailers; enclosing document and decoder measured separately"});
    fs::write(
        format!("{DIR}/manifest.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    Ok(())
}
fn tests() {
    let mut seed = 871u32;
    for n in (0..80).chain([87, 88, 89, 127, 128, 129, 255, 256, 257, 1023, 4097]) {
        let data: Vec<u8> = (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 24) as u8
            })
            .collect();
        for radix in [253, 254] {
            for method in 0..7 {
                if method == 4 && radix != 254 {
                    continue;
                }
                for mask in [0, 85, 255] {
                    let p = encode::pack(&data, mask, 0, method, radix);
                    native_check(&data, &p, method, radix, mask);
                }
            }
        }
        for method in [6, 8, 9] {
            for mask in [0, 85, 255] {
                let packet = encode::pack_wide(&data, mask, 0, method);
                let mut out = vec![0; n];
                core::decode(
                    &mut core::Words {
                        data: &packet[3..],
                        at: 0,
                        radix: 63484,
                    },
                    &mut out,
                    mask,
                    63484,
                    method,
                )
                .unwrap();
                assert_eq!(out, data);
            }
        }
    }
    // Low-entropy final states exposed a real two-digit state-header overflow
    // in the word rANS prototype. Keep that case in the fast native-only suite,
    // including odd lengths whose final high byte must be zero padding.
    for n in [1, 7, 8, 9, 127, 128, 129, 4097] {
        for fill in [0, 255] {
            let data = vec![fill; n];
            for method in [8, 9] {
                for mask in [0, 255] {
                    let packet = encode::pack_wide(&data, mask, 0, method);
                    let mut output = vec![0; n];
                    core::decode(
                        &mut core::Words {
                            data: &packet[3..],
                            at: 0,
                            radix: 63484,
                        },
                        &mut output,
                        mask,
                        63484,
                        method,
                    )
                    .unwrap();
                    assert_eq!(output, data);
                }
            }
        }
    }
    println!("Native boundary, mask and round-trip checks passed");
}
fn vectors() -> Result<(), Box<dyn std::error::Error>> {
    let profiles = literal::profiles();
    let mut vectors = Vec::new();
    let mut seed = 1901u32;
    for n in [
        0, 1, 2, 3, 7, 8, 9, 31, 32, 33, 63, 64, 65, 87, 88, 89, 127, 128, 129, 255, 256, 257, 1023,
    ] {
        let data: Vec<_> = (0..n)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 24) as u8
            })
            .collect();
        for kind in 0..3u8 {
            for mask in [0, 255] {
                let bytes = stored(&data, kind);
                vectors.push(vector(&data, &bytes, kind, mask, false, &profiles));
            }
        }
    }
    for kind in [1, 2] {
        let data: Vec<u8> = (0..37).collect();
        let mut bytes = stored(&data, kind);
        bytes[0] ^= 1;
        vectors.push(vector(&data, &bytes, kind, 0, true, &profiles));
    }
    fs::write(
        format!("{DIR}/vectors.json"),
        serde_json::to_vec_pretty(&vectors)?,
    )?;
    println!("Prepared {} browser vectors", vectors.len());
    Ok(())
}
fn vector(
    data: &[u8],
    bytes: &[u8],
    kind: u8,
    mask: u8,
    reject: bool,
    profiles: &[literal::Profile],
) -> Value {
    let mut packets = serde_json::Map::new();
    for radix in [254, 253] {
        for method in 0..7 {
            if radix == 253 && !matches!(method, 1 | 6) {
                continue;
            }
            let p = encode::pack(bytes, mask, kind, method, radix);
            let alphabet = &profiles[if radix == 254 { 11 } else { 10 }].alphabet;
            let units: Vec<_> = p.iter().map(|&d| alphabet[d as usize]).collect();
            packets.insert(
                format!("r{radix}-{}", NAMES[method as usize]),
                json!(String::from_utf16(&units).unwrap()),
            );
        }
    }
    for (method, name) in [(6, "ans4"), (8, "ans16x4"), (9, "ans16x4precise")] {
        let p = encode::pack_wide(bytes, mask, kind, method);
        let units: Vec<_> = p
            .iter()
            .map(|&d| profiles[3].alphabet[d as usize])
            .collect();
        packets.insert(
            format!("wide-{name}"),
            json!(String::from_utf16(&units).unwrap()),
        );
    }
    for (name, alphabet) in [
        ("production", &profiles[0].alphabet),
        ("wide", &profiles[3].alphabet),
    ] {
        let mut p = literal::pack(bytes, mask, alphabet);
        let first = alphabet.iter().position(|&c| c == p[0]).unwrap();
        p[0] = alphabet[first - 512 + kind as usize * 256];
        packets.insert(name.into(), json!(String::from_utf16(&p).unwrap()));
    }
    packets.insert("base64".into(), json!(base64(bytes)));
    json!({"kind":kind,"mask":mask,"reject":reject,"expectedHex":glyphpack::tooling::fixtures::hex(data),"packets":packets})
}
fn documents() -> Result<(), Box<dyn std::error::Error>> {
    let manifest: Value = serde_json::from_slice(&fs::read(format!("{DIR}/manifest.json"))?)?;
    let selected=env::var("PACK_VARIANTS").unwrap_or_else(|_|"production,wide-wasm,wide-ans16x4precise-wasm16,r254-ans4-wasm16,r254-group64-wasm16,r253-ans4-wasm16,base64-native".into());
    let datasets =
        env::var("PACK_DATASETS").unwrap_or_else(|_| "random-1KiB,random-1MiB,random-10MiB".into());
    let variants = manifest["variants"].as_array().unwrap();
    let root = fs::canonicalize(".")?;
    let helper = String::from_utf8(run(Command::new(glyphpack::builder::esbuild_path(None))
        .args([
            "benchmarks/experiments/template-literals/raw-tag.js",
            "--minify",
            "--target=chrome109",
            "--legal-comments=none",
        ]))?)?;
    let mut inverse = vec![u16::MAX; 65536];
    for (b, cp) in literal::byte_alphabet(true).into_iter().enumerate() {
        inverse[cp as usize] = b as u16;
    }
    let mut docs = Vec::new();
    let tick = char::from(96);
    for variant in variants.iter().filter(|v| {
        selected
            .split(',')
            .any(|s| s == v["name"].as_str().unwrap())
    }) {
        let name = variant["name"].as_str().unwrap();
        // The repository defaults .js to CommonJS. This entry must remain ESM
        // so bundling preserves the decoder's top-level-await initialization.
        let entry = Path::new(DIR).join("inline-entry.mjs");
        fs::write(
            &entry,
            format!(
                "import{{binary}}from{:?};globalThis.__PACK_DECODE__=binary;",
                root.join(variant["module"].as_str().unwrap())
            ),
        )?;
        let inline = Path::new(DIR).join(format!("{name}.inline.js"));
        bundle(&entry, &inline, &[])?;
        let code = fs::read_to_string(&inline)?;
        assert!(!code.to_ascii_lowercase().contains("</script") && !code.contains("<!--"));
        for row in manifest["rows"].as_array().unwrap().iter().filter(|r| {
            r["kind"] == 2
                && datasets
                    .split(',')
                    .any(|s| s == r["dataset"].as_str().unwrap())
        }) {
            let packet = &row["packets"][variant["packet"].as_str().unwrap()];
            let raw = fs::read(packet["text"].as_str().unwrap())?;
            let units: Vec<_> = raw
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            let context = match variant["context"].as_str().unwrap() {
                "RawText" => literal::Context::RawText,
                "Tagged" => literal::Context::Tagged,
                _ => literal::Context::Cooked,
            };
            let escaped = literal::source(&units, context);
            let text = String::from_utf16(&escaped)?;
            let encoding = variant["encoding"].as_str().unwrap();
            let mut html = format!(
                "<!doctype html><meta charset={encoding}><title>Packing experiment</title>"
            );
            if matches!(context, literal::Context::RawText) {
                html.push_str(&format!(
                    "<script type=application/octet-stream id=p>{text}</script>"
                ));
            }
            html.push_str("<script type=\"module\">");
            html.push_str(&code);
            if matches!(context, literal::Context::Tagged) {
                html.push_str(&helper)
            }
            let expression = match context {
                literal::Context::RawText => "document.getElementById('p').textContent".into(),
                literal::Context::Cooked => format!("{tick}{text}{tick}"),
                literal::Context::Tagged => format!("rawTag{tick}{text}{tick}"),
            };
            html.push_str(&format!("\n;{{try{{const started=performance.now();const out=globalThis.__PACK_DECODE__({expression},2);globalThis.packingBytes=out;globalThis.packingLoad={{readyMs:performance.now(),callMs:performance.now()-started,length:out.length,charset:document.characterSet,protocol:location.protocol}};}}catch(e){{globalThis.packingFailure=e.message;}}}}</script><i id=end></i>"));
            let bytes: Vec<u8> = if encoding == "utf-16le" {
                std::iter::once(0xfeff)
                    .chain(html.encode_utf16())
                    .flat_map(u16::to_le_bytes)
                    .collect()
            } else if encoding == "utf-8" {
                html.into_bytes()
            } else {
                html.encode_utf16()
                    .map(|cp| {
                        let b = inverse[cp as usize];
                        assert_ne!(b, u16::MAX);
                        b as u8
                    })
                    .collect()
            };
            let file = format!("{DIR}/{}-{name}.html", row["dataset"].as_str().unwrap());
            fs::write(&file, &bytes)?;
            docs.push(json!({"name":name,"dataset":row["dataset"],"bytes":row["bytes"],"file":file,"encoding":encoding,"htmlBytes":bytes.len(),"gzip9HtmlBytes":gzip9(&bytes).map_err(std::io::Error::other)?.len(),"decoderInlineBytes":code.len(),"sourceBytes":packet["sourceBytes"],"expected":row["expected"]}));
        }
    }
    fs::write(
        format!("{DIR}/documents.json"),
        serde_json::to_vec_pretty(&docs)?,
    )?;
    println!("Built {} self-contained documents", docs.len());
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(DIR)?;
    tests();
    let args: Vec<_> = env::args().collect();
    if args.iter().any(|s| s == "--test") {
        return Ok(());
    }
    if args.iter().any(|s| s == "--report") {
        return report::write();
    }
    if args.iter().any(|s| s == "--vectors") {
        return vectors();
    }
    if args.iter().any(|s| s == "--documents") {
        return documents();
    }
    if args.iter().any(|s| s == "--build-only") {
        let builds = build()?;
        fs::write(
            format!("{DIR}/builds.json"),
            serde_json::to_vec_pretty(&builds)?,
        )?;
        let mut manifest: Value =
            serde_json::from_slice(&fs::read(format!("{DIR}/manifest.json"))?)?;
        manifest["variants"] = builds;
        fs::write(
            format!("{DIR}/manifest.json"),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        return Ok(());
    }
    let builds = if args.iter().any(|s| s == "--reuse-build") {
        serde_json::from_slice(&fs::read(format!("{DIR}/builds.json"))?)?
    } else {
        let b = build()?;
        fs::write(format!("{DIR}/builds.json"), serde_json::to_vec_pretty(&b)?)?;
        b
    };
    prepare(builds)
}
