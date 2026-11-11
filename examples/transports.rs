//! 0BSD, NeoX. Matched raw-script transport comparison. Native preparation is
//! Rust; actual browser decoding and measurements use the shared JS harnesses.
#[path = "../benchmarks/experiments/packing/encode.rs"]
#[allow(dead_code)]
mod byte_encode;
#[path = "../benchmarks/experiments/packing/core.rs"]
#[allow(dead_code)]
mod core;
use previous::literal;
#[path = "compact.rs"]
#[allow(dead_code)]
mod previous;
#[path = "../benchmarks/experiments/transports/report.rs"]
mod report;
use glyphpack::{builder::BuildOptions, transport::gzip9};
use serde_json::{json, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
};
const DIR: &str = "generated/transports";
fn source(free: bool) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let root = fs::canonicalize(".")?;
    let dir = Path::new(DIR).join(if free { "source253" } else { "source254" });
    fs::create_dir_all(&dir)?;
    let mut t = fs::read_to_string("crates/decoder-wasm/src/lib.rs")?
        .replace(
            "../../../src/hash.rs",
            &root.join("src/hash.rs").display().to_string(),
        )
        .replace("mod unpack;", "mod windows;")
        .replace(
            "const RADIX: u64 = 63385;",
            if free {
                "const RADIX: u64 = 253;"
            } else {
                "const RADIX: u64 = 254;"
            },
        );
    let begin = t.find("        let mut index = 0u16;").unwrap();
    let end = begin + t[begin..].find("        self.initialized = true;").unwrap();
    let alpha = alphabet(free);
    let init=format!("        for (digit,cp) in {:?}.into_iter().enumerate(){{table[cp as usize]=digit as u16+1;}}\n",alpha);
    t.replace_range(begin..end, &init);
    let begin = t.find("        let (Some(a), Some(b))").unwrap();
    let end = begin + t[begin..].find("        let kind = mode >> 8;").unwrap();
    t.replace_range(begin..end,r#"        let start=6;
        if input.len()<start{return LENGTH}
        let mut settings=0i64;let mut power=1i64;
        for pos in 0..2{let d=i64::from(table[input[pos]as usize]);if verify_format&&d==0{return CHARACTER}settings+=(d-1)*power;power*=RADIX as i64;}
        if settings<0||settings>>10!=6{return HEADER}
        let mode=(settings as u32)&1023;
        let mut length=0i64;let mut power=1i64;
        for pos in 2..6{let d=i64::from(table[input[pos]as usize]);if verify_format&&d==0{return CHARACTER}length+=(d-1)*power;power*=RADIX as i64;}
"#);
    t = t
        .replace(
            "if verify_format && (kind == 3 || (input.len() - start) % 2 != 0)",
            "if verify_format && kind == 3",
        )
        .replace(
            "((input.len() - start) as u64) * 2",
            "(input.len() - start) as u64",
        );
    let begin = t.find("        if heavy && self.high_ptr == 0 {").unwrap();
    let end = begin
        + t[begin..]
            .find("        if length > self.output_cap {")
            .unwrap();
    t.replace_range(begin..end, "");
    let begin = t.find("        let high = if heavy {").unwrap();
    let end = begin + t[begin..].find("        if result != 0 {").unwrap();
    t.replace_range(begin..end,"        let result=if verify_format{windows::unpack::<true>(input,start,output,mask,table)}else{windows::unpack::<false>(input,start,output,mask,table)};\n");
    fs::write(dir.join("lib.rs"), t)?;
    fs::copy(
        "benchmarks/experiments/transports/windows.rs",
        dir.join("windows.rs"),
    )?;
    Ok(dir.join("lib.rs"))
}
fn alphabet(free: bool) -> Vec<u16> {
    literal::byte_alphabet(true)
        .into_iter()
        .enumerate()
        .filter(|(b, _)| *b != 13 && *b != 60 && (!free || *b != 0))
        .map(|(_, c)| c)
        .collect()
}
fn prepare() -> Result<(), Box<dyn std::error::Error>> {
    let mut variants = Vec::new();
    let old: Value = serde_json::from_slice(&fs::read("generated/compact/builds.json")?)?;
    for name in ["pair-control", "ans4", "ans1"] {
        let mut b = old
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["name"] == name)
            .unwrap()
            .clone();
        b["packet"] = json!(if name == "pair-control" { "pair" } else { name });
        b["encoding"] = json!("utf-16le");
        variants.push(b);
    }
    for free in [false, true] {
        let entry = source(free)?;
        let name = if free { "windows253" } else { "windows254" };
        let flags = if free { vec!["nul-free"] } else { vec![] };
        let mut b = previous::module(&entry, name, &flags, &BuildOptions::default())?;
        b["packet"] = json!(name);
        b["encoding"] = json!("windows-1252");
        variants.push(b);
    }
    let old: Value = serde_json::from_slice(&fs::read("generated/compact/manifest.json")?)?;
    let mut rows = Vec::new();
    for r in old["rows"].as_array().unwrap() {
        let mut row = r.clone();
        let bytes = fs::read(r["expected"].as_str().unwrap())?;
        let kind = r["kind"].as_u64().unwrap() as u8;
        let mask = r["packets"]["pair"]["mask"].as_u64().unwrap() as u8;
        for free in [false, true] {
            let a = alphabet(free);
            let d = byte_encode::pack(&bytes, mask, kind, 6, a.len() as u32);
            let units: Vec<_> = d.into_iter().map(|d| a[d as usize]).collect();
            let name = if free { "windows253" } else { "windows254" };
            let file = format!("{DIR}/{}-{kind}-{name}.u16", r["dataset"].as_str().unwrap());
            fs::write(
                &file,
                units
                    .iter()
                    .flat_map(|u| u.to_le_bytes())
                    .collect::<Vec<_>>(),
            )?;
            row["packets"][name] =
                json!({"text":file,"sourceBytes":units.len(),"units":units.len(),"mask":mask});
        }
        rows.push(row);
    }
    fs::write(
        format!("{DIR}/manifest.json"),
        serde_json::to_vec_pretty(
            &json!({"schema":1,"variants":variants,"rows":rows,"scope":"same raw-script container, allocator, hashes, adapter and production-selected mask"}),
        )?,
    )?;
    Ok(())
}
fn documents() -> Result<(), Box<dyn std::error::Error>> {
    let m: Value = serde_json::from_slice(&fs::read(format!("{DIR}/manifest.json"))?)?;
    let root = fs::canonicalize(".")?;
    let mut docs = Vec::new();
    let raw_alphabet = literal::byte_alphabet(true);
    let mut inv = vec![u16::MAX; 65536];
    for (b, &c) in raw_alphabet.iter().enumerate() {
        inv[c as usize] = b as u16;
    }
    for v in m["variants"].as_array().unwrap() {
        let name = v["name"].as_str().unwrap();
        let entry = Path::new(DIR).join("entry.mjs");
        let inline = Path::new(DIR).join(format!("{name}-inline.js"));
        fs::write(
            &entry,
            format!(
                "import{{binary}}from{:?};globalThis.__PACK_DECODE__=binary;",
                root.join(v["public"].as_str().unwrap())
            ),
        )?;
        previous::bundle(&entry, &inline)?;
        let code = fs::read_to_string(&inline)?;
        assert!(!code.to_ascii_lowercase().contains("</script") && !code.contains("<!--"));
        for r in m["rows"].as_array().unwrap().iter().filter(|r| {
            r["kind"] == 2
                && ["empty", "random-1KiB", "random-1MiB", "random-10MiB"]
                    .iter()
                    .any(|s| r["dataset"] == *s)
        }) {
            let p = &r["packets"][v["packet"].as_str().unwrap()];
            let raw = fs::read(p["text"].as_str().unwrap())?;
            let text = String::from_utf16(
                &raw.chunks_exact(2)
                    .map(|b| u16::from_le_bytes([b[0], b[1]]))
                    .collect::<Vec<_>>(),
            )?;
            let encoding = v["encoding"].as_str().unwrap();
            let html=format!("<!doctype html><meta charset={encoding}><title>Matched transports</title><script type=application/octet-stream id=p>{text}</script><script type=module>{code};try{{const start=performance.now();const out=__PACK_DECODE__(document.getElementById('p').textContent);globalThis.packingBytes=out;globalThis.packingLoad={{readyMs:performance.now(),callMs:performance.now()-start,length:out.length,charset:document.characterSet,protocol:location.protocol}}}}catch(e){{globalThis.packingFailure=e.message}}</script><i id=end></i>");
            let encoded = if encoding == "utf-16le" {
                glyphpack::injector::utf16_document(&html)
            } else {
                html.encode_utf16()
                    .map(|c| {
                        let b = inv[c as usize];
                        assert_ne!(b, u16::MAX);
                        b as u8
                    })
                    .collect()
            };
            let file = format!("{DIR}/{}-{name}.html", r["dataset"].as_str().unwrap());
            fs::write(&file, &encoded)?;
            docs.push(json!({"name":name,"dataset":r["dataset"],"bytes":r["bytes"],"encoding":encoding,"file":file,"htmlBytes":encoded.len(),"sourceBytes":p["sourceBytes"],"expected":r["expected"],"decoderInlineBytes":code.len(),"nulBytes":encoded.iter().filter(|&&b|b==0).count(),"utf8TranscodedBytes":html.replace("charset=windows-1252","charset=utf-8").len(),"gzipHtmlBytes":gzip9(&encoded).map_err(std::io::Error::other)?.len()}));
        }
    }
    fs::write(
        format!("{DIR}/documents.json"),
        serde_json::to_vec_pretty(&docs)?,
    )?;
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all(DIR)?;
    let args: Vec<_> = env::args().collect();
    if args.iter().any(|s| s == "--report") {
        return report::write();
    }
    if args.iter().any(|s| s == "--documents") {
        documents()
    } else {
        prepare()?;
        documents()
    }
}
