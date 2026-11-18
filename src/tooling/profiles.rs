//! Reproducible distributions and the complete 63-profile feature matrix.
use crate::{
    builder::{build_decoder, build_wasm, BuildOptions},
    encoder::{self, EncodeOptions, Integrity, Packing},
    injector,
};
use serde_json::{json, Value};
use std::{fs, path::Path};

pub fn matrix() -> Vec<BuildOptions> {
    let mut rows = Vec::new();
    for formats in [vec![false], vec![true], vec![false, true]] {
        for bits in 1u8..8 {
            let data: Vec<_> = [Integrity::None, Integrity::Fast, Integrity::Secure]
                .into_iter()
                .enumerate()
                .filter_map(|(i, v)| ((bits & (1 << i)) != 0).then_some(v))
                .collect();
            for memory in [vec![false], vec![true], vec![false, true]] {
                rows.push(BuildOptions {
                    formats: formats.clone(),
                    data: data.clone(),
                    memory,
                    ..BuildOptions::default()
                });
            }
        }
    }
    rows
}

pub fn build_all(root: &Path) -> Result<Value, String> {
    let out = root.join("dist");
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let profiles = [
        ("default", BuildOptions::default()),
        ("recommended", BuildOptions::default()),
        ("recommended-full", BuildOptions::recommended_full()),
        (
            "utf8",
            BuildOptions {
                packings: vec![Packing::Utf8],
                ..BuildOptions::default()
            },
        ),
        (
            "utf8-compact",
            BuildOptions {
                packings: vec![Packing::Utf8Compact],
                ..BuildOptions::default()
            },
        ),
        (
            "ans",
            BuildOptions {
                packings: vec![Packing::Ans],
                ..BuildOptions::default()
            },
        ),
        (
            "windows",
            BuildOptions {
                packings: vec![Packing::Windows],
                ..BuildOptions::default()
            },
        ),
        (
            "core",
            BuildOptions {
                formats: vec![false],
                data: vec![Integrity::None],
                ..BuildOptions::default()
            },
        ),
        (
            "none",
            BuildOptions {
                formats: vec![false],
                data: vec![Integrity::None],
                ..BuildOptions::default()
            },
        ),
        (
            "fast-none",
            BuildOptions {
                formats: vec![false, true],
                data: vec![Integrity::None, Integrity::Fast],
                ..BuildOptions::default()
            },
        ),
        (
            "high-memory",
            BuildOptions {
                memory: vec![true],
                ..BuildOptions::default()
            },
        ),
        ("full", BuildOptions::full()),
    ];
    let mut manifest = serde_json::Map::new();
    for (name, options) in profiles {
        let wasm_path = build_wasm(&options)?;
        if name == "full" {
            fs::copy(&wasm_path, root.join("generated/wasm/full.wasm"))
                .map_err(|e| e.to_string())?;
        }
        let wasm = fs::read(wasm_path).map_err(|e| e.to_string())?;
        let gzip_bytes = crate::transport::gzip(&wasm)?.len();
        for minify in [false, true] {
            let file = format!("{name}{}.mjs", if minify { ".min" } else { "" });
            let source = build_decoder(&BuildOptions {
                minify,
                ..options.clone()
            })?;
            manifest.insert(
                file.clone(),
                json!({
                    "bytes":source.len(),
                    "blake3":super::fixtures::hex(&crate::hash::blake3(source.as_bytes())),
                    "backend":if options.packings.iter().any(|p|p.is_utf8()) {"js+wasm"}else{"wasm"}, "browserTarget":"chrome109",
                    "formatVersion":encoder::FORMAT_VERSION,
                    "compactHash":options.compact_hash,
                    "packings":options.packings.iter().map(|p|p.name()).collect::<Vec<_>>(),
                    "verifyFormat":options.formats,"verifyData":options.data.iter().map(|m|m.name()).collect::<Vec<_>>(),"memoryHeavy":options.memory,
                    "wasmBytes":wasm.len(), "gzipBytes":gzip_bytes, "gzipEncoder":"zopfli-100",
                    "base64Bytes":gzip_bytes.div_ceil(3)*4
                }),
            );
            fs::write(
                out.join(file.replace(".mjs", ".d.mts")),
                crate::builder::type_declaration(&options)?,
            )
            .map_err(|e| e.to_string())?;
            fs::write(out.join(&file), source).map_err(|e| e.to_string())?;
        }
    }
    // Explicit raw UTF-8 entry point: no digest, Wasm, fetch or gzip loader.
    // This does not alter the security defaults of any existing profile.
    for minify in [false, true] {
        let file = format!("utf8-raw{}.mjs", if minify { ".min" } else { "" });
        let source = crate::utf8_raw::build_decoder(root, false, minify)?;
        manifest.insert(file.clone(), json!({
            "bytes":source.len(), "blake3":super::fixtures::hex(&crate::hash::blake3(source.as_bytes())),
            "backend":"js", "browserTarget":"chrome109", "formatVersion":2,
            "documentEncoding":"utf-8", "verifyFormat":true, "verifyData":"none", "lookupBytes":4096
        }));
        fs::write(out.join(file.replace(".mjs", ".d.mts")),
            "/** Raw UTF-8 transport. Checks encoding structure, without a digest or MAC. */\nexport declare function decode(text: string): Uint8Array;\n/** Optional, idempotent 4 KiB lookup initialization; decode calls it automatically. */\nexport declare function warmup(): void;\n").map_err(|e|e.to_string())?;
        fs::write(out.join(file), source).map_err(|e| e.to_string())?;
    }
    // A real file:// entry point: embed the readable default module and payload
    // in the document. No external ESM import, fetch, worker or server is needed.
    let text = encoder::encode_text(
        "Hello from GlyphPack. ✓".as_bytes(),
        &EncodeOptions::default(),
    )?;
    let payload = injector::payload_element("payload", &text, &Default::default())?;
    let decoder = fs::read_to_string(out.join("default.mjs")).map_err(|e| e.to_string())?;
    let html=format!("<!doctype html><meta charset=\"utf-8\"><title>GlyphPack standalone</title><output>Loading…</output>{payload}<script type=\"module\">{decoder}\ndocument.querySelector('output').textContent=new TextDecoder().decode(binary(document.getElementById('payload').textContent));</script>\n");
    fs::write(out.join("standalone.html"), html).map_err(|e| e.to_string())?;
    let raw = crate::utf8_raw::encode("Hello from GlyphPack. ✓".as_bytes(), 0)?;
    let raw_decoder = crate::utf8_raw::build_decoder(root, true, true)?;
    let raw_html = format!("\u{feff}<!doctype html><meta charset=utf-8><title>GlyphPack UTF-8 standalone</title><output>Loading…</output><script>{raw_decoder}globalThis.unpacked=GlyphUTF8.decode(\"{}\");document.querySelector('output').textContent=new TextDecoder().decode(unpacked);</script>\n", crate::utf8_raw::script_literal(&raw));
    fs::write(out.join("utf8-raw-standalone.html"), raw_html).map_err(|e| e.to_string())?;
    fs::write(
        out.join("profiles.json"),
        serde_json::to_string_pretty(&manifest).unwrap() + "\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({"profiles":12,"moduleFiles":manifest.len(),"output":out}))
}
