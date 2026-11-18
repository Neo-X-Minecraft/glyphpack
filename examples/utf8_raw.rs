//! 0BSD, NeoX. UTF-8-only raw transport CLI and standalone HTML builder.
use glyphpack::utf8_raw::{build_decoder, encode, script_literal, select_mask};
use std::{fs, path::Path};
fn save(path: &str, data: impl AsRef<[u8]>) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(p) = Path::new(path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        fs::create_dir_all(p)?;
    }
    fs::write(path, data)?;
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().skip(1).collect();
    if a.first().is_some_and(|s| s == "build") {
        let p = a
            .get(1)
            .ok_or("Usage: utf8_raw build decoder.mjs [--classic]")?;
        if a[2..].iter().any(|s| s != "--classic") {
            return Err("Unknown build option".into());
        }
        return save(
            p,
            build_decoder(
                Path::new(env!("CARGO_MANIFEST_DIR")),
                a.iter().any(|s| s == "--classic"),
                true,
            )?,
        );
    }
    if a.first().is_some_and(|s| s == "encode" || s == "html") {
        let (input, output) = (
            a.get(1).ok_or("Missing input")?,
            a.get(2).ok_or("Missing output")?,
        );
        let mask = match a.get(3).map(String::as_str) {
            None => None,
            Some("--mask") if a.len() == 5 => Some(a[4].parse::<u8>()?),
            _ => return Err("Use --mask 0..255".into()),
        };
        if fs::metadata(input)?.len() > 0x40000000 {
            return Err("Payload too large".into());
        }
        let data = fs::read(input)?;
        let packet = encode(&data, mask.unwrap_or_else(|| select_mask(&data)))?;
        if a[0] == "html" {
            let code = build_decoder(Path::new(env!("CARGO_MANIFEST_DIR")), true, true)?;
            save(output,format!("\u{feff}<!doctype html><meta charset=utf-8><script>{code}globalThis.unpacked=GlyphUTF8.decode(\"{}\");</script>",script_literal(&packet)))
        } else {
            save(output, packet)
        }
    } else {
        Err("Use encode, html or build".into())
    }
}
