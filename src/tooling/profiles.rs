//! Reproducible distributions and the complete 63-profile feature matrix.
use crate::{
    builder::{build_decoder, build_wasm, BuildOptions},
    encoder::{self, EncodeOptions, Integrity},
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
        let wasm = fs::read(build_wasm(&options)?).map_err(|e| e.to_string())?;
        let gzip_bytes = crate::transport::gzip9(&wasm)?.len();
        for minify in [false, true] {
            let file = format!("{name}{}.mjs", if minify { ".min" } else { "" });
            let source = build_decoder(&BuildOptions {
                module: true,
                minify,
                ..options.clone()
            })?;
            manifest.insert(
                file.clone(),
                json!({
                    "bytes":source.len(),
                    "blake3":super::fixtures::hex(&crate::hash::blake3(source.as_bytes())),
                    "backend":"wasm", "browserTarget":"chrome109",
                    "wasmBytes":wasm.len(), "gzip9Bytes":gzip_bytes,
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
    fs::write(
        out.join("profiles.json"),
        serde_json::to_string_pretty(&manifest).unwrap() + "\n",
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({"profiles":6,"moduleFiles":manifest.len(),"output":out}))
}
