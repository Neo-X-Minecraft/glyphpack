//! Build the static Pages demo. The optional browser encoder shares the native
//! encoder source and stays separate from every decoder distribution.
use crate::{
    builder::esbuild_path,
    encoder::{encode_text, EncodeOptions, Integrity},
    transport::{base64, gzip9},
};
use serde_json::json;
use std::{
    env, fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
fn io<T>(v: std::io::Result<T>) -> Result<T, String> {
    v.map_err(|e| e.to_string())
}
fn run(command: &mut Command) -> Result<(), String> {
    let out = io(command.output())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into())
    }
}

pub fn build(root: &Path, out: &Path) -> Result<(), String> {
    io(fs::create_dir_all(out))?;
    // esbuild runs from the checkout; output paths retain the caller's meaning.
    let out = io(fs::canonicalize(out))?;
    let target = root.join("generated/site-build");
    let cargo = env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    run(Command::new(cargo)
        .args([
            "build", "--locked", "--profile", "wasm-release", "--target",
            "wasm32-unknown-unknown", "-p", "glyphpack-encoder-wasm", "--target-dir",
        ])
        .arg(&target)
        .env("CARGO_ENCODED_RUSTFLAGS", "-C\x1flink-arg=-zstack-size=65536\x1f-C\x1ftarget-cpu=mvp\x1f-C\x1ftarget-feature=+mutable-globals")
        .current_dir(root))?;
    let optimizer = env::var_os("WASM_OPT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| root.join("node_modules/.bin/wasm-opt"));
    let raw = target.join("wasm32-unknown-unknown/wasm-release/glyphpack_encoder_wasm.wasm");
    let lowered = target.join("encoder.wasm");
    let validated = target.join("encoder-mvp.wasm");
    // The shared encoder uses std. Lower instructions in Rust's prebuilt std,
    // then validate baseline Wasm independently, just like the decoder build.
    run(Command::new(&optimizer)
        .arg(&raw)
        .args([
            "--all-features",
            "--disable-memory64",
            "--disable-multimemory",
            "-O3",
            "--converge",
            "--llvm-memory-copy-fill-lowering",
            "--signext-lowering",
            "--llvm-nontrapping-fptoint-lowering",
            "--strip-dwarf",
            "--strip-producers",
            "-o",
        ])
        .arg(&lowered))?;
    run(Command::new(&optimizer)
        .arg(&lowered)
        .args(["--mvp-features", "--enable-mutable-globals", "-o"])
        .arg(&validated))?;
    let wasm = io(fs::read(validated))?;
    let compressed = gzip9(&wasm)?;
    let source = format!(
        "{}\nexport const api=await loadWasm({:?});\n",
        include_str!("../decoder/loader.js"),
        base64(&compressed)
    );
    let mut child = io(Command::new(esbuild_path(None))
        .args([
            "--loader=js",
            "--format=esm",
            "--target=chrome109",
            "--minify",
            "--legal-comments=none",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn())?;
    io(child.stdin.take().unwrap().write_all(source.as_bytes()))?;
    let result = io(child.wait_with_output())?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into());
    }
    io(fs::write(out.join("encoder.mjs"), result.stdout))?;
    io(fs::copy(
        root.join("site/index.html"),
        out.join("index.html"),
    ))?;
    // Keep readable sources in git; ship small independent browser modules.
    run(Command::new(esbuild_path(None))
        .current_dir(root)
        .args([
            "site/app.mjs",
            "site/codec-worker.mjs",
            "site/styles.css",
            "--format=esm",
            "--target=chrome109",
            "--minify",
            "--legal-comments=none",
            "--out-extension:.js=.mjs",
        ])
        .arg(format!("--outdir={}", out.display())))?;
    io(fs::write(out.join(".nojekyll"), ""))?;
    io(fs::create_dir_all(out.join("lib")))?;
    for file in ["default.min.mjs", "full.min.mjs", "core.min.mjs"] {
        io(fs::copy(
            root.join("dist").join(file),
            out.join("lib").join(file),
        ))?;
    }
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="480" height="180" viewBox="0 0 480 180"><rect width="480" height="180" fill="#171a1d"/><path d="M32 136H448M32 36V136" stroke="#687078"/><path d="M32 118L96 102L160 110L224 64L288 82L352 42L448 28" fill="none" stroke="#dfebdd" stroke-width="4"/><g fill="#dfebdd"><circle cx="224" cy="64" r="5"/><circle cx="352" cy="42" r="5"/></g><text x="40" y="164" fill="#a6afb6" font-family="monospace" font-size="12">A vector asset, restored from packed bytes.</text></svg>"##;
    let config=br#"{"project":"GlyphPack","theme":"dark","features":["local files","Wasm","offline HTML"],"retries":3}"#.to_vec();
    let unicode="Hello, 世界. Καλημέρα. Привет. مرحبًا. 🌍\nOriginal text is UTF-8 bytes. The payload uses BMP glyphs.\n".as_bytes().to_vec();
    let log = (0..100)
        .map(|i| format!("{{\"event\":\"sensor\",\"sequence\":{i},\"ok\":true}}\n"))
        .collect::<String>();
    let inputs = vec![
        (
            "json",
            "JSON settings",
            "An embedded config, ready for JSON.parse.",
            "settings.json",
            "application/json",
            config,
        ),
        (
            "unicode",
            "Unicode text",
            "UTF-8 text, emoji, and multiple writing systems.",
            "hello.txt",
            "text/plain",
            unicode,
        ),
        (
            "svg",
            "Vector image",
            "Restore an SVG asset without losing its vectors.",
            "chart.svg",
            "image/svg+xml",
            svg.as_bytes().to_vec(),
        ),
        (
            "bytes",
            "Every byte",
            "All 256 byte values, including zero and FF.",
            "all-bytes.bin",
            "application/octet-stream",
            (0..=255).collect(),
        ),
        (
            "gzip",
            "Gzip log",
            "A compressed asset: decode first, then inflate.",
            "events.jsonl.gz",
            "application/gzip",
            gzip9(log.as_bytes())?,
        ),
        (
            "empty",
            "Empty file",
            "Zero input bytes with a real integrity trailer.",
            "empty.bin",
            "application/octet-stream",
            Vec::new(),
        ),
    ];
    let mut samples = Vec::new();
    for (id, title, description, name, mime, data) in inputs {
        let mut packets = serde_json::Map::new();
        for integrity in [Integrity::None, Integrity::Fast, Integrity::Secure] {
            packets.insert(
                integrity.name().into(),
                json!(encode_text(
                    &data,
                    &EncodeOptions {
                        integrity,
                        ..EncodeOptions::default()
                    }
                )?),
            );
        }
        samples.push(json!({"id":id,"title":title,"description":description,"name":name,"mime":mime,"bytes":data.len(),"packets":packets}));
    }
    io(fs::write(
        out.join("samples.json"),
        serde_json::to_vec(&samples).unwrap(),
    ))?;
    println!(
        "{}",
        json!({"site":out,"samples":samples.len(),"encoderWasmBytes":wasm.len(),"encoderGzipBytes":compressed.len()})
    );
    Ok(())
}
