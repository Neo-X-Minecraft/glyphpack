//! 0BSD, NeoX. Optional-packing builder proof and matched-container experiments.
//! Production files are read, copied and patched ONLY under generated/compact.
#[path = "../benchmarks/experiments/compact/encode.rs"]
mod compact_encode;
#[path = "../benchmarks/experiments/template-literals/codec.rs"]
#[allow(dead_code)]
mod literal;
#[path = "../benchmarks/experiments/compact/report.rs"]
mod report;
use glyphpack::{
    builder::{self, BuildOptions},
    encoder::{self, EncodeOptions, Integrity},
    hash,
    transport::gzip9,
};
use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
const DIR: &str = "generated/compact";
const SRC: &str = "benchmarks/experiments/compact";
fn run(c: &mut Command) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let o = c.output()?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).into_owned().into());
    }
    Ok(o.stdout)
}
fn bundle(entry: &Path, out: &Path) -> Result<(), Box<dyn std::error::Error>> {
    run(Command::new(builder::esbuild_path(None))
        .arg(entry)
        .args([
            "--bundle",
            "--format=esm",
            "--target=chrome109",
            "--minify",
            "--legal-comments=none",
        ])
        .arg(format!("--outfile={}", out.display())))?;
    Ok(())
}
fn patch_once(text: &mut String, old: &str, new: &str) {
    assert_eq!(text.matches(old).count(), 1, "patch anchor {old}");
    *text = text.replacen(old, new, 1);
}
fn source() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let root = fs::canonicalize(".")?;
    let dir = Path::new(DIR).join("source");
    fs::create_dir_all(&dir)?;
    let mut text = fs::read_to_string("crates/decoder-wasm/src/lib.rs")?.replace(
        "../../../src/hash.rs",
        &root.join("src/hash.rs").display().to_string(),
    );
    patch_once(
        &mut text,
        "mod unpack;",
        "#[cfg(feature=\"pair\")]\nmod unpack;\nmod compact;",
    );
    // Header bands >=33792 were rejected by checked format 3. Keep its pair
    // header and body byte-for-byte unchanged; compact profiles get new bands.
    let anchor = "        if cfg!(feature = \"legacy\") {";
    patch_once(
        &mut text,
        anchor,
        r#"        let compact_id=if first>=33792 {Some(((first-33792)as u32)>>10)}else{None};
        if let Some(id)=compact_id {
            if !compact::supports(id){return HEADER}
            let Some(c)=digit(input,table,2)else{return LENGTH};
            if verify_format&&c==0{return CHARACTER}
            start=3;mode=(first as u32)&1023;
            length=i64::from(b)-1+RADIX as i64*(i64::from(c)-1);
        } else if !cfg!(feature="pair") {return HEADER}
        else if cfg!(feature = "legacy") {"#,
    );
    patch_once(&mut text,"if verify_format && (kind == 3 || (input.len() - start) % 2 != 0)","if verify_format && (kind == 3 || (compact_id.is_none() && (input.len() - start) % 2 != 0))");
    patch_once(
        &mut text,
        "        if heavy && self.high_ptr == 0 {",
        "        let heavy=heavy&&compact_id.is_none();\n        if heavy && self.high_ptr == 0 {",
    );
    let begin = text
        .find("        let result = match (verify_format, heavy) {")
        .unwrap();
    let end = begin + text[begin..].find("        if result != 0 {").unwrap();
    let old = text[begin..end].to_string();
    let expression = old
        .trim()
        .strip_prefix("let result = ")
        .unwrap()
        .strip_suffix(';')
        .unwrap();
    let replacement=format!("        let result=if let Some(id)=compact_id {{compact::unpack(input,start,output,mask,table,verify_format,id)}}else{{\n#[cfg(feature=\"pair\")]{{{expression}}}\n#[cfg(not(feature=\"pair\"))]{{HEADER}}\n}};\n");
    text.replace_range(begin..end, &replacement);
    fs::write(dir.join("lib.rs"), text)?;
    fs::copy("crates/decoder-wasm/src/unpack.rs", dir.join("unpack.rs"))?;
    fs::copy(format!("{SRC}/compact.rs"), dir.join("compact.rs"))?;
    Ok(dir.join("lib.rs"))
}
fn compile(
    entry: &Path,
    name: &str,
    features: &[&str],
    options: &BuildOptions,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let raw = Path::new(DIR).join(format!("{name}.raw.wasm"));
    let wasm = Path::new(DIR).join(format!("{name}.wasm"));
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
    let mut flags = features.to_vec();
    if options.formats.len() > 1 {
        flags.push("format-runtime");
        flags.push("format")
    } else if options.formats[0] {
        flags.push("format")
    }
    for mode in &options.data {
        flags.push(mode.name())
    }
    if options.memory.len() > 1 {
        flags.extend(["memory-runtime", "memory-heavy"])
    } else if options.memory[0] {
        flags.push("memory-heavy")
    }
    for flag in flags {
        cmd.arg("--cfg").arg(format!("feature={flag:?}"));
    }
    run(cmd.arg(entry).arg("-o").arg(&raw))?;
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
fn policy(name: &str) -> BuildOptions {
    match name {
        "full" => BuildOptions::full(),
        "core" => BuildOptions {
            formats: vec![false],
            data: vec![Integrity::None],
            ..Default::default()
        },
        _ => BuildOptions::default(),
    }
}
fn module(
    entry: &Path,
    name: &str,
    flags: &[&str],
    options: &BuildOptions,
) -> Result<Value, Box<dyn std::error::Error>> {
    let wasm = compile(entry, name, flags, options)?;
    let bytes = fs::read(&wasm)?;
    let public = Path::new(DIR).join(format!("{name}.mjs"));
    let adapter = builder::build_adapter(options, &bytes)?;
    fs::write(&public, &adapter)?;
    fs::write(
        public.with_extension("d.mts"),
        builder::type_declaration(options)?,
    )?;
    let wrapper = Path::new(DIR).join(format!("{name}-entry.mjs"));
    let root = fs::canonicalize(".")?;
    fs::write(&wrapper,format!("import{{binary as decode}}from{:?};export function binary(t,k=2,f=true,h=false){{return decode(t,{{verifyFormat:f,verifyData:['none','fast','secure'][k],memoryHeavy:h}})}}export function memory(){{return null}}",root.join(&public)))?;
    let bench = Path::new(DIR).join(format!("{name}-bench.mjs"));
    bundle(&wrapper, &bench)?;
    Ok(
        json!({"name":name,"public":public,"module":bench,"kernel":wasm,"features":flags,"kinds":options.data.iter().map(|x|x.kind()).collect::<Vec<_>>(),"formats":options.formats,"memories":options.memory,"moduleBytes":adapter.len(),"moduleGzipBytes":gzip9(adapter.as_bytes()).map_err(std::io::Error::other)?.len(),"wasmBytes":bytes.len(),"wasmGzipBytes":gzip9(&bytes).map_err(std::io::Error::other)?.len(),"publicBlake3":glyphpack::tooling::fixtures::hex(&hash::blake3(adapter.as_bytes()))}),
    )
}
fn builds() -> Result<Value, Box<dyn std::error::Error>> {
    let entry = source()?;
    let control_dir = Path::new(DIR).join("control-source");
    fs::create_dir_all(&control_dir)?;
    let root = fs::canonicalize(".")?;
    fs::write(
        control_dir.join("lib.rs"),
        fs::read_to_string("crates/decoder-wasm/src/lib.rs")?.replace(
            "../../../src/hash.rs",
            &root.join("src/hash.rs").display().to_string(),
        ),
    )?;
    fs::copy(
        "crates/decoder-wasm/src/unpack.rs",
        control_dir.join("unpack.rs"),
    )?;
    let mut list = Vec::new();
    for (name, flags, p) in [
        ("pair-control", vec!["pair"], "secure"),
        ("pair-control-full", vec!["pair"], "full"),
        ("pair-control-core", vec!["pair"], "core"),
        ("pair", vec!["pair"], "secure"),
        ("ans4", vec!["ans4"], "secure"),
        ("ans1", vec!["ans1"], "secure"),
        ("ans2", vec!["ans2"], "secure"),
        ("ans8", vec!["ans8"], "secure"),
        ("ans-low", vec!["ans-low"], "secure"),
        ("both", vec!["pair", "ans4"], "secure"),
        ("pair-full", vec!["pair"], "full"),
        ("ans4-full", vec!["ans4"], "full"),
        ("both-full", vec!["pair", "ans4"], "full"),
        ("pair-core", vec!["pair"], "core"),
        ("ans4-core", vec!["ans4"], "core"),
        ("both-core", vec!["pair", "ans4"], "core"),
        (
            "all",
            vec!["pair", "ans4", "ans1", "ans2", "ans8", "ans-low"],
            "full",
        ),
    ] {
        let kernel_entry = if name.starts_with("pair-control") {
            control_dir.join("lib.rs")
        } else {
            entry.clone()
        };
        list.push(module(&kernel_entry, name, &flags, &policy(p))?);
        println!("Built {name}")
    }
    let out = json!(list);
    fs::write(
        format!("{DIR}/builds.json"),
        serde_json::to_vec_pretty(&out)?,
    )?;
    Ok(out)
}
fn stored(data: &[u8], kind: u8) -> Vec<u8> {
    let mut bytes = data.to_vec();
    match kind {
        1 => bytes.extend(hash::xxhash32(data).to_le_bytes()),
        2 => bytes.extend(hash::blake3(data)),
        _ => (),
    }
    bytes
}
fn packet(data: &[u8], bytes: &[u8], kind: u8, mask: u8, name: &str) -> Result<Vec<u16>, String> {
    if name == "pair" {
        encoder::encode_units(
            data,
            &EncodeOptions {
                integrity: [Integrity::None, Integrity::Fast, Integrity::Secure][kind as usize],
                mask: Some(mask),
                ..Default::default()
            },
        )
    } else {
        let p = match name {
            "ans4" => 0,
            "ans1" => 1,
            "ans2" => 2,
            "ans8" => 3,
            "ans-low" => 4,
            _ => return Err("packet".into()),
        };
        Ok(compact_encode::packet(bytes, mask, kind, p))
    }
}
fn packet_names() -> [&'static str; 6] {
    ["pair", "ans4", "ans1", "ans2", "ans8", "ans-low"]
}
fn prepare(builds: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let originals: Vec<Value> =
        serde_json::from_slice(&fs::read("generated/encoder-benchmark/inputs.json")?)?;
    let mut inputs: Vec<(String, Vec<u8>)> = originals
        .iter()
        .map(|v| {
            Ok((
                v["label"].as_str().unwrap().to_string(),
                fs::read(v["binary"].as_str().unwrap())?,
            ))
        })
        .collect::<Result<_, std::io::Error>>()?;
    let random = inputs
        .iter()
        .find(|(s, _)| s == "random-10MiB")
        .unwrap()
        .1
        .clone();
    for n in [16, 64, 256, 4096, 16384, 262144, 524288, 2097152, 4194304] {
        inputs.push((format!("random-{n}B"), random[..n].to_vec()));
    }
    let mut rows = Vec::new();
    for (label, data) in inputs {
        for kind in 0..3 {
            let bytes = stored(&data, kind);
            let expected = format!("{DIR}/{label}-{kind}.bin");
            fs::write(&expected, &bytes)?;
            // Match the SAME production-selected mask across every algorithm.
            // Mask selection is outside all decoder timers, as is hashing.
            let mask = encoder::choose_mask(&bytes, encoder::Effort::Full).mask;
            let mut packets = serde_json::Map::new();
            for name in packet_names() {
                let units = packet(&data, &bytes, kind, mask, name)?;
                let file = format!("{DIR}/{label}-{kind}-{name}.u16");
                fs::write(
                    &file,
                    units
                        .iter()
                        .flat_map(|c| c.to_le_bytes())
                        .collect::<Vec<_>>(),
                )?;
                packets.insert(name.into(),json!({"text":file,"sourceBytes":units.len()*2,"templateSourceBytes":literal::cooked(&units).len()*2,"mask":mask,"units":units.len()}));
            }
            rows.push(json!({"dataset":label,"bytes":data.len(),"kind":kind,"expected":expected,"packets":packets}));
        }
        println!("Prepared {label}");
    }
    let mut variants = Vec::new();
    for b in builds.as_array().unwrap() {
        let name = b["name"].as_str().unwrap();
        if name == "all" {
            continue;
        }
        let packets: Vec<_> = if name.starts_with("pair-control") {
            vec!["pair"]
        } else if name.starts_with("both") {
            vec!["pair", "ans4"]
        } else {
            vec![name
                .strip_suffix("-full")
                .or_else(|| name.strip_suffix("-core"))
                .unwrap_or(name)]
        };
        for p in packets {
            let mut v = b.clone();
            v["name"] = json!(if name.starts_with("both") {
                format!("{name}-{p}")
            } else {
                name.to_string()
            });
            v["packet"] = json!(p);
            variants.push(v);
        }
    }
    fs::write(
        format!("{DIR}/manifest.json"),
        serde_json::to_vec_pretty(
            &json!({"schema":1,"alphabet":63385,"maskPolicy":"same production-selected XOR mask for every algorithm","variants":variants,"rows":rows}),
        )?,
    )?;
    Ok(())
}
fn vectors() -> Result<(), Box<dyn std::error::Error>> {
    let mut rows = Vec::new();
    let mut state = 677u32;
    for n in (0..40).chain([
        63, 64, 65, 127, 128, 129, 255, 256, 257, 1023, 1024, 1025, 4097,
    ]) {
        for fill in [None, Some(0), Some(255)] {
            let data: Vec<u8> = (0..n)
                .map(|_| {
                    state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                    fill.unwrap_or((state >> 24) as u8)
                })
                .collect();
            for mask in [0, 85, 255] {
                for kind in 0..3 {
                    let bytes = stored(&data, kind);
                    let mut packets = serde_json::Map::new();
                    for name in packet_names() {
                        packets.insert(
                            name.into(),
                            json!(
                                String::from_utf16(&packet(&data, &bytes, kind, mask, name)?)
                                    .unwrap()
                            ),
                        );
                    }
                    rows.push(json!({"kind":kind,"mask":mask,"rawHex":glyphpack::tooling::fixtures::hex(&data),"packets":packets}));
                }
            }
        }
    }
    // Structurally valid stale trailers test integrity independently of any
    // character, padding or terminal-state check in the transport decoder.
    for kind in [1, 2] {
        let data: Vec<u8> = (0..257).map(|i| i as u8).collect();
        let mut bytes = stored(&data, kind);
        bytes[0] ^= 1;
        let mut packets = serde_json::Map::new();
        for name in packet_names() {
            let units = if name == "pair" {
                let a = encoder::alphabet();
                let mut p = literal::pack(&bytes, 0, a);
                let h = a.binary_search(&p[0]).unwrap();
                p[0] = a[h - 512 + kind as usize * 256];
                p
            } else {
                packet(&data, &bytes, kind, 0, name)?
            };
            packets.insert(name.into(), json!(String::from_utf16(&units)?));
        }
        rows.push(json!({"kind":kind,"mask":0,"rawHex":"","reject":true,"packets":packets}));
    }
    fs::write(format!("{DIR}/vectors.json"), serde_json::to_vec(&rows)?)?;
    println!("Generated {} vector rows", rows.len());
    Ok(())
}
fn documents() -> Result<(), Box<dyn std::error::Error>> {
    let manifest: Value = serde_json::from_slice(&fs::read(format!("{DIR}/manifest.json"))?)?;
    let selected =
        env::var("COMPACT_VARIANTS").unwrap_or_else(|_| "pair,ans4,both-pair,both-ans4".into());
    let datasets = env::var("COMPACT_DATASETS")
        .unwrap_or_else(|_| "random-1KiB,random-1MiB,random-10MiB".into());
    let root = fs::canonicalize(".")?;
    let mut docs = Vec::new();
    for v in manifest["variants"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| selected.split(',').any(|n| v["name"] == n))
    {
        let entry = Path::new(DIR).join("inline.mjs");
        let inline = Path::new(DIR).join(format!("{}-inline.js", v["name"].as_str().unwrap()));
        fs::write(
            &entry,
            format!(
                "import{{binary}}from{:?};globalThis.__PACK_DECODE__=binary",
                root.join(v["public"].as_str().unwrap())
            ),
        )?;
        bundle(&entry, &inline)?;
        let code = fs::read_to_string(&inline)?;
        assert!(!code.to_ascii_lowercase().contains("</script") && !code.contains("<!--"));
        for r in manifest["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["kind"] == 2 && datasets.split(',').any(|n| r["dataset"] == n))
        {
            let p = &r["packets"][v["packet"].as_str().unwrap()];
            let bytes = fs::read(p["text"].as_str().unwrap())?;
            let units: Vec<_> = bytes
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            for container in ["raw", "template"] {
                let mut html =
                    "<!doctype html><meta charset=utf-16le><title>Matched packing</title>"
                        .to_string();
                if container == "raw" {
                    html.push_str(&format!(
                        "<script type=application/octet-stream id=p>{}</script>",
                        String::from_utf16(&units)?
                    ))
                }
                html.push_str("<script type=module>");
                html.push_str(&code);
                let expression = if container == "raw" {
                    "document.getElementById('p').textContent".into()
                } else {
                    format!("`{}`", String::from_utf16(&literal::cooked(&units))?)
                };
                html.push_str(&format!(";try{{const start=performance.now();const out=__PACK_DECODE__({expression});globalThis.packingBytes=out;globalThis.packingLoad={{readyMs:performance.now(),callMs:performance.now()-start,length:out.length,charset:document.characterSet,protocol:location.protocol}}}}catch(e){{globalThis.packingFailure=e.message}}</script><i id=end></i>"));
                let encoded = glyphpack::injector::utf16_document(&html);
                let name = format!("{}-{container}", v["name"].as_str().unwrap());
                let file = format!("{DIR}/{}-{name}.html", r["dataset"].as_str().unwrap());
                fs::write(&file, &encoded)?;
                docs.push(json!({"name":name,"codec":v["name"],"container":container,"dataset":r["dataset"],"bytes":r["bytes"],"file":file,"encoding":"utf-16le","htmlBytes":encoded.len(),"decoderInlineBytes":code.len(),"sourceBytes":if container=="raw"{p["sourceBytes"].clone()}else{p["templateSourceBytes"].clone()},"expected":r["expected"]}));
            }
        }
    }
    fs::write(
        format!("{DIR}/documents.json"),
        serde_json::to_vec_pretty(&docs)?,
    )?;
    println!("Built {} matched-container files", docs.len());
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(DIR)?;
    let args: Vec<_> = env::args().collect();
    if args.iter().any(|a| a == "--report") {
        return report::write();
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("Experimental compact builder: --packing pair|ans|ans-small (comma-separated combinations allowed) --policy secure|full|core --output FILE.mjs\nWithout --output: generate the matched comparison. Other stages: --build-only, --reuse-build, --vectors, --documents.");
        return Ok(());
    }
    if let Some(i) = args.iter().position(|a| a == "--output") {
        let packing = args
            .windows(2)
            .find(|a| a[0] == "--packing")
            .map_or("pair", |a| a[1].as_str());
        let profile = args
            .windows(2)
            .find(|a| a[0] == "--policy")
            .map_or("secure", |a| a[1].as_str());
        if !["secure", "core", "full"].contains(&profile) {
            return Err("policy must be secure, core or full".into());
        }
        let mut flags = Vec::new();
        for name in packing.split(',') {
            let flag = match name {
                "pair" => "pair",
                "ans" => "ans4",
                "ans-small" => "ans1",
                _ => return Err("packing choices are pair, ans and ans-small".into()),
            };
            if !flags.contains(&flag) {
                flags.push(flag)
            }
        }
        flags.sort_unstable();
        let entry = source()?;
        let options = policy(profile);
        let result = module(&entry, "custom", &flags, &options)?;
        let output = Path::new(args.get(i + 1).ok_or("missing output")?);
        fs::copy(result["public"].as_str().unwrap(), output)?;
        fs::copy(
            Path::new(result["public"].as_str().unwrap()).with_extension("d.mts"),
            output.with_extension("d.mts"),
        )?;
        println!("Built optional {packing} decoder: {}", output.display());
        return Ok(());
    }
    if args.iter().any(|a| a == "--documents") {
        return documents();
    }
    if args.iter().any(|a| a == "--vectors") {
        return vectors();
    }
    let built = if args.iter().any(|a| a == "--reuse-build") {
        serde_json::from_slice(&fs::read(format!("{DIR}/builds.json"))?)?
    } else {
        builds()?
    };
    if args.iter().any(|a| a == "--build-only") {
        return Ok(());
    }
    prepare(&built)?;
    vectors()
}
