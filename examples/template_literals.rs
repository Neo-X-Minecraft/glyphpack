//! Generate size measurements and real UTF-16LE HTML parser fixtures locally.
//! Native encoding stays in Rust; the independent browser decoder is JS.
#[path = "../benchmarks/experiments/template-literals/codec.rs"]
mod codec;
#[path = "../benchmarks/experiments/template-literals/report.rs"]
mod report;
use codec::Context;
use glyphpack::{encoder, hash};
use serde_json::{json, Value};
use std::{env, fs, path::Path, process::Command, sync::OnceLock, time::Instant};

fn tag_helper() -> &'static str {
    static HELPER: OnceLock<String> = OnceLock::new();
    HELPER.get_or_init(|| {
        let output = Command::new(glyphpack::builder::esbuild_path(None))
            .args([
                "benchmarks/experiments/template-literals/raw-tag.js",
                "--minify",
                "--target=chrome109",
                "--legal-comments=none",
            ])
            .output()
            .expect("run pinned esbuild");
        assert!(output.status.success(), "minify tagged-template helper");
        String::from_utf8(output.stdout).expect("UTF-8 helper")
    })
}

fn write_units(path: &Path, units: &[u16]) -> std::io::Result<()> {
    fs::write(
        path,
        units
            .iter()
            .flat_map(|c| c.to_le_bytes())
            .collect::<Vec<_>>(),
    )
}
fn document(source: &[u16], context: Context) -> Vec<u16> {
    let tick = char::from(96);
    let (prefix, suffix) = match context {
        Context::RawText => (
            "<!doctype html><script id=p type=application/octet-stream>".to_string(),
            "</script><script type=\"module\">globalThis.packet=document.getElementById('p').textContent;</script><i id=end></i>".to_string(),
        ),
        Context::Cooked => (
            format!("<!doctype html><script type=\"module\">globalThis.packet={tick}"),
            format!("{tick};</script><i id=end></i>"),
        ),
        Context::Tagged => (
            format!("<!doctype html><script type=\"module\">{};globalThis.packet=rawTag{tick}", tag_helper()),
            format!("{tick};</script><i id=end></i>"),
        ),
    };
    std::iter::once(0xfeff)
        .chain(prefix.encode_utf16())
        .chain(source.iter().copied())
        .chain(suffix.encode_utf16())
        .collect()
}
fn html_bytes(source: &[u16], context: Context, single_byte: bool) -> Vec<u8> {
    let doc = document(source, context);
    if !single_byte {
        return doc.iter().flat_map(|c| c.to_le_bytes()).collect();
    }
    static INVERSE: OnceLock<Vec<u16>> = OnceLock::new();
    let inverse = INVERSE.get_or_init(|| {
        let mut table = vec![u16::MAX; 65536];
        for (byte, cp) in codec::byte_alphabet(true).into_iter().enumerate() {
            table[cp as usize] = byte as u16;
        }
        table
    });
    // No BOM: the explicit early meta tag selects the single-byte encoding.
    // Source NUL is intentionally tokenized as U+FFFD inside script data.
    let text = String::from_utf16(&doc[1..]).unwrap().replacen(
        "<!doctype html>",
        "<!doctype html><meta charset=windows-1252>",
        1,
    );
    text.encode_utf16()
        .map(|c| {
            let byte = inverse[c as usize];
            assert_ne!(
                byte,
                u16::MAX,
                "source character lacks a single-byte representation"
            );
            byte as u8
        })
        .collect()
}
#[allow(clippy::too_many_arguments)]
fn save_case(
    folder: &Path,
    cases: &mut Vec<Value>,
    name: &str,
    units: &[u16],
    context: Context,
    profile: Option<usize>,
    stored: Option<&str>,
    negative: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let escaped = if negative {
        units.to_vec()
    } else {
        codec::source(units, context)
    };
    let html = format!("{name}.html");
    let single_byte = profile.is_some_and(|id| id >= 10);
    fs::write(
        folder.join(&html),
        html_bytes(&escaped, context, single_byte),
    )?;
    let expected = if stored.is_none() {
        let file = format!("{name}.u16");
        write_units(&folder.join(&file), units)?;
        Some(file)
    } else {
        None
    };
    cases.push(json!({"name":name,"html":html,"expectedUnits":expected,"stored":stored,"profile":profile,"negative":negative,"context":format!("{context:?}"),"encoding":if single_byte{"windows-1252"}else{"utf-16le"},"expectedScripts":if matches!(context,Context::RawText){2}else{1},"classicToo":stored.is_none()}));
    Ok(())
}
fn forced(alphabet: &[u16], pattern: &[u16], repeat: usize) -> Vec<u8> {
    assert_eq!(pattern.len() % 2, 0);
    let mut out = Vec::new();
    for _ in 0..repeat {
        for pair in pattern.chunks_exact(2) {
            let lo = alphabet.iter().position(|&c| c == pair[0]).unwrap() as u32;
            let hi = alphabet.iter().position(|&c| c == pair[1]).unwrap() as u32;
            let value = lo + alphabet.len() as u32 * hi;
            assert!(
                value & 0x7fffffff
                    <= (alphabet.len() as u64 * alphabet.len() as u64 - 2147483649) as u32
            );
            out.extend(value.to_le_bytes());
        }
    }
    out
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.iter().any(|a| a == "--report") {
        return report::write();
    }
    let quick = args.iter().any(|a| a == "--quick");
    let folder = Path::new("generated/template-literals");
    fs::create_dir_all(folder)?;
    let profiles = codec::profiles();
    let manifest: Vec<Value> =
        serde_json::from_slice(&fs::read("generated/encoder-benchmark/inputs.json")?)?;
    let mut inputs: Vec<(String, Vec<u8>)> = Vec::new();
    for input in manifest {
        let name = input["label"].as_str().unwrap();
        if quick && !matches!(name, "empty" | "random-1KiB" | "random-1MiB" | "ff-1MiB") {
            continue;
        }
        inputs.push((
            name.to_string(),
            fs::read(input["binary"].as_str().unwrap())?,
        ));
    }
    inputs.push((
        "forced-interpolation".into(),
        forced(&profiles[3].alphabet, &[36, 123], 1024),
    ));
    inputs.push((
        "forced-script-end".into(),
        forced(
            &profiles[3].alphabet,
            &"</ScRiPt> ".encode_utf16().collect::<Vec<_>>(),
            256,
        ),
    ));
    inputs.push((
        "forced-comment-open".into(),
        forced(
            &profiles[3].alphabet,
            &"<!--".encode_utf16().collect::<Vec<_>>(),
            1024,
        ),
    ));
    let mut rows = Vec::new();
    let mut cases = Vec::new();
    for (dataset, data) in &inputs {
        let mut stored = data.clone();
        stored.extend(hash::blake3(data));
        let stored_file = format!("{dataset}.stored.bin");
        fs::write(folder.join(&stored_file), &stored)?;
        for (id, profile) in profiles.iter().enumerate() {
            let started = Instant::now();
            let (mask, packet, escaped, considered) = codec::choose(&stored, profile);
            // Cross-check the generic reference against the real production
            // encoder before trusting any alternative-alphabet measurements.
            if id == 0 {
                assert_eq!(
                    packet,
                    encoder::encode_units(data, &encoder::EncodeOptions::default())?
                );
            }
            for policy in ["fixed0", "source-optimal"] {
                let (m, p, s) = if policy == "fixed0" {
                    let p = codec::pack(&stored, 0, &profile.alphabet);
                    let s = codec::source(&p, profile.context);
                    (0, p, s)
                } else {
                    (mask, packet.clone(), escaped.clone())
                };
                let text = String::from_utf16(&s)?;
                let name = format!("{dataset}-{}-{policy}", profile.name);
                let persist = policy == "source-optimal" || dataset.starts_with("forced-");
                let single_byte = profile.alphabet.len() <= 256;
                let doc = html_bytes(&s, profile.context, single_byte);
                rows.push(json!({"dataset":dataset,"inputBytes":data.len(),"storedBytes":stored.len(),"profile":profile.name,"radix":profile.alphabet.len(),"context":format!("{:?}",profile.context),"encoding":if single_byte{"windows-1252"}else{"utf-16le"},"policy":policy,"mask":m,"packetUnits":p.len(),"sourceUnits":s.len(),"extraUnits":s.len()-p.len(),"payloadBytes":s.len()*if single_byte{1}else{2},"payloadUtf8Bytes":text.len(),"htmlBytes":doc.len(),"headerUnits":if single_byte{6}else if stored.len()<32*profile.alphabet.len(){2}else{3},"consideredMasks":considered,"generationMs":started.elapsed().as_secs_f64()*1000.}));
                if persist {
                    save_case(
                        folder,
                        &mut cases,
                        &name,
                        &p,
                        profile.context,
                        Some(id),
                        Some(&stored_file),
                        false,
                    )?;
                }
            }
            println!(
                "{dataset} / {}: {} bytes",
                profile.name,
                escaped.len() * if profile.alphabet.len() <= 256 { 1 } else { 2 }
            );
        }
    }
    // Every code unit is tested through native HTML decoding and JS compilation.
    // Escaped lone surrogates must remain lone code units in the resulting string.
    let all: Vec<_> = (0..=65535u16).collect();
    save_case(
        folder,
        &mut cases,
        "all-code-units",
        &all,
        Context::Cooked,
        None,
        None,
        false,
    )?;
    for (id, p) in profiles.iter().enumerate() {
        save_case(
            folder,
            &mut cases,
            &format!("alphabet-{id}"),
            &p.alphabet,
            p.context,
            Some(id),
            None,
            false,
        )?;
    }
    let mut hazards = vec![0xfeff, 0x2028, 0x2029, 0xffff, 0xfffe, 0xfdd0];
    for digit in 48..=57 {
        hazards.extend([0, digit, 13, 10]);
    }
    hazards.push(96);
    hazards.extend("\\u0000\\x00\\8\\9".encode_utf16());
    hazards.extend([36, 123]);
    hazards.extend("globalThis.injected=1}<!--<script>-->".encode_utf16());
    for variant in 0..64 {
        let name: String = "script"
            .chars()
            .enumerate()
            .map(|(i, c)| {
                if variant & (1 << i) != 0 {
                    c.to_ascii_uppercase()
                } else {
                    c
                }
            })
            .collect();
        for ending in [" ", "\t", "\n", "\r", "\u{c}", "/", ">", "", "x>"] {
            hazards.extend(format!("</{name}{ending}").encode_utf16());
        }
    }
    for n in 0..17 {
        let slashes = "\\".repeat(n);
        let dollar = char::from(36);
        hazards.extend(
            format!("{slashes}{dollar}{{x}} <{slashes}!-- <{slashes}/sCrIpT> ").encode_utf16(),
        );
    }
    hazards.extend([0xd800, 0xdc00, 0xd800, 65, 0xdc00, 0xfeff, 92]);
    save_case(
        folder,
        &mut cases,
        "cooked-hazards",
        &hazards,
        Context::Cooked,
        None,
        None,
        false,
    )?;
    let tag_hazards: Vec<_> = hazards
        .iter()
        .copied()
        .filter(|c| ![0, 13, 96].contains(c) && !(0xd800..=0xdfff).contains(c))
        .collect();
    save_case(
        folder,
        &mut cases,
        "tagged-hazards",
        &tag_hazards,
        Context::Tagged,
        None,
        None,
        false,
    )?;
    let mut long_runs = vec![92; 65536];
    long_runs.extend("x <".encode_utf16());
    long_runs.extend(std::iter::repeat_n(92, 65536));
    long_runs.extend("x".encode_utf16());
    save_case(
        folder,
        &mut cases,
        "long-slash-runs",
        &long_runs,
        Context::Tagged,
        None,
        None,
        false,
    )?;
    let mut lookalikes = Vec::new();
    for suffix in ["ſcript", "scrıpt", "scrİpt", "SCRIPT", "sCrIpT", "scriptx"] {
        for n in [0, 1, 2, 3, 16, 255] {
            lookalikes.extend(format!("<{}/{}> ", "\\".repeat(n), suffix).encode_utf16());
        }
    }
    save_case(
        folder,
        &mut cases,
        "tagged-case-lookalikes",
        &lookalikes,
        Context::Tagged,
        None,
        None,
        false,
    )?;
    // Exercise every BMP unit adjacent to each lexical delimiter, including
    // Unicode escape lookalikes and both valid/invalid surrogate boundaries.
    let mut boundaries = Vec::with_capacity(65536 * 16 * 5);
    for c in 0..=65535u16 {
        for special in [
            0, 10, 13, 36, 60, 92, 96, 123, 47, 33, 45, 62, 0xd800, 0xdc00, 0xfeff, 0xffff,
        ] {
            boundaries.extend([special, c, special, 65]);
        }
    }
    save_case(
        folder,
        &mut cases,
        "all-delimiter-boundaries",
        &boundaries,
        Context::Cooked,
        None,
        None,
        false,
    )?;
    for (name, raw) in [
        (
            "unsafe-script-end",
            "</script><script>globalThis.injected=1</script>".to_string(),
        ),
        ("unsafe-comment-open", "<!--<script>".into()),
        (
            "unsafe-interpolation",
            format!("{}{{(globalThis.injected=1)}}", char::from(36)),
        ),
        ("unsafe-backtick", "a\u{60}b".into()),
        ("unsafe-backslash", "\\u0041".into()),
        ("unsafe-cr", "\r".into()),
        ("unsafe-nul", "\0".into()),
    ] {
        save_case(
            folder,
            &mut cases,
            name,
            &raw.encode_utf16().collect::<Vec<_>>(),
            Context::Cooked,
            None,
            None,
            true,
        )?;
    }
    save_case(
        folder,
        &mut cases,
        "unsafe-surrogate",
        &[0xd800],
        Context::Cooked,
        None,
        None,
        true,
    )?;
    let metadata: Vec<_> = profiles.iter().map(|p|json!({"name":p.name,"radix":p.alphabet.len(),"encoding":if p.alphabet.len()<=256{"windows-1252"}else{"utf-16le"},"context":format!("{:?}",p.context),"entropyBitsPerUnit":(p.alphabet.len() as f64).log2(),"idealAsymptoticOverheadPct":(if p.alphabet.len()<=256{8.}else{16.}/(p.alphabet.len() as f64).log2()-1.)*100.})).collect();
    let report = json!({"schema":1,"quick":quick,"format":"UTF-16: production-style header and 31/32-bit pairs. Single-byte: 6-digit header and 15/16-bit pairs. Both include XOR and a 32-byte BLAKE3 trailer for size parity.","sourceOnly":true,"profiles":metadata,"rows":rows,"cases":cases});
    fs::write(
        folder.join("manifest.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!(
        "Wrote {} measurements and {} HTML cases",
        rows.len(),
        cases.len()
    );
    Ok(())
}
