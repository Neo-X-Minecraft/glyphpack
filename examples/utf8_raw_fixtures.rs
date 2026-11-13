//! 0BSD, NeoX. Public/synthetic native fixtures for UTF-8 transport comparison.
use glyphpack::utf8_raw::{build_decoder, encode, script_literal};
use serde_json::json;
use std::{fs, path::Path};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = Path::new("generated/utf8-rival");
    fs::create_dir_all(dir)?;
    let inputs: serde_json::Value =
        serde_json::from_slice(&fs::read("generated/encoding-comparison/inputs.json")?)?;
    let mut rows = vec![];
    for r in inputs.as_array().unwrap() {
        let label = r["label"].as_str().unwrap();
        if !matches!(
            label,
            "random-1KiB"
                | "random-64KiB"
                | "random-1MiB"
                | "zeros-1MiB"
                | "sequential-1MiB"
                | "bootstrap"
        ) {
            continue;
        }
        let binary = r["binary"].as_str().unwrap();
        let data = fs::read(binary)?;
        let packet = encode(&data, 0)?;
        let file = dir.join(format!("{label}.txt"));
        fs::write(&file, &packet)?;
        rows.push(json!({"label":label,"binary":binary,"file":file,"bytes":data.len(),"payloadBytes":packet.len(),"base122":r["texts"]["none"]["base122"]}));
    }
    let mut cases = vec![];
    for n in (0..=96).chain([
        127, 128, 129, 255, 256, 257, 511, 512, 513, 1023, 1024, 1025, 4095, 4096, 4097,
    ]) {
        for pattern in 0..4 {
            let mut state = 815u32;
            let data: Vec<_> = (0..n)
                .map(|i| match pattern {
                    0 => 0,
                    1 => 255,
                    2 => i as u8,
                    _ => {
                        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                        (state >> 24) as u8
                    }
                })
                .collect();
            for mask in [0, 85, 255] {
                cases.push(json!({"text":encode(&data,mask)?,"hex":data.iter().map(|b|format!("{b:02x}")).collect::<String>()}));
            }
        }
    }
    // All masks on a full byte cycle exercise every header mask and XOR path.
    let data: Vec<u8> = (0..257).map(|i| i as u8).collect();
    for mask in 0..=255u8 {
        cases.push(
            json!({"text":encode(&data,mask)?,"hex":glyphpack::tooling::fixtures::hex(&data)}),
        );
    }
    let classic = build_decoder(Path::new(env!("CARGO_MANIFEST_DIR")), true, true)?;
    fs::write(dir.join("decoder.iife.js"), &classic)?;
    fs::write(
        dir.join("decoder.min.mjs"),
        build_decoder(Path::new(env!("CARGO_MANIFEST_DIR")), false, true)?,
    )?;
    let mut pages = vec![];
    // These bytes deliberately encode into active HTML-tokenizer transitions.
    // Exercise the actual native builder, rather than a JS copy of its escape.
    for (name, mut groups) in [
        (
            "closing-script",
            "</script><script>globalThis.pwned=1</script>".to_owned(),
        ),
        (
            "double-escaped-script",
            "<!--<ScRiPt></ScRiPt><script>globalThis.pwned=1</script>".to_owned(),
        ),
        ("quotes-context", "'`${globalThis.pwned=1}`<svg>".to_owned()),
    ] {
        while groups.len() % 8 != 0 {
            groups.push('A');
        }
        let mut data = vec![];
        let (mut q, mut bits) = (0u32, 0);
        for c in groups.bytes() {
            q = (q << 7) | u32::from(c);
            bits += 7;
            if bits >= 8 {
                bits -= 8;
                data.push((q >> bits) as u8);
            }
        }
        let packet = encode(&data, 0)?;
        assert!(packet.ends_with(&groups));
        let file = dir.join(format!("{name}.html"));
        let html = format!("\u{feff}<!doctype html><meta charset=utf-8><script>{classic}globalThis.unpacked=GlyphUTF8.decode(\"{}\");</script>",script_literal(&packet));
        fs::write(&file, html)?;
        pages.push(json!({"name":name,"file":file,"hex":glyphpack::tooling::fixtures::hex(&data)}));
    }
    // Ten MiB independent public LCG bytes cover large native HTML generation.
    let mut state = 0x4a81u32;
    let large: Vec<u8> = (0..10 * 1024 * 1024)
        .map(|_| {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            (state >> 24) as u8
        })
        .collect();
    fs::write(dir.join("large.bin"), &large)?;
    let packet = encode(&large, 0)?;
    fs::write(dir.join("large.html"),format!("\u{feff}<!doctype html><meta charset=utf-8><script>{classic}globalThis.unpacked=GlyphUTF8.decode(\"{}\");</script>",script_literal(&packet)))?;
    // The frozen alphabet is shared with the earlier experiment, not selected
    // using the host browser's potentially changing Unicode classification.
    #[path = "../src/utf8-raw/alphabet.rs"]
    mod alphabet;
    fs::write(
        dir.join("wide.json"),
        serde_json::to_vec(&alphabet::PORTABLE[..1536])?,
    )?;
    fs::write(
        dir.join("manifest.json"),
        serde_json::to_vec(&json!({"rows":rows,"cases":cases,"pages":pages}))?,
    )?;
    Ok(())
}
