//! 0BSD, NeoX. Compare final packaged size across Binaryen strategies using
//! identical Rust/LLVM inputs, adapters and gzip settings. No timing is done
//! here; benchmarks/optimize.cjs measures the exact resulting browser modules.
use glyphpack::{
    builder::{self, BuildOptions},
    transport,
};
use serde_json::json;
use std::{fs, path::Path, process::Command};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = Path::new("generated/optimization");
    fs::create_dir_all(dir)?;
    let root = fs::canonicalize(".")?;
    let label = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "candidate-".into());
    let mut manifest = if !dir.join("candidates.json").is_file() {
        json!({"rows":[]})
    } else {
        serde_json::from_slice(&fs::read(dir.join("candidates.json"))?)?
    };
    let mut rows = manifest["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| !r["variant"].as_str().unwrap().starts_with(&label))
        .cloned()
        .collect::<Vec<_>>();
    for (profile, mut options) in [
        ("recommended", BuildOptions::default()),
        ("recommended-full", BuildOptions::recommended_full()),
        ("full", BuildOptions::full()),
    ] {
        options.compact_hash = std::env::var("OPT_COMPACT").as_deref() == Ok("1");
        let baseline = builder::build_wasm(&options)?;
        let key = builder::profile_key(&options);
        let raw = root.join(format!(
            "generated/wasm/build/{key}/wasm32v1-none/wasm-release/glyphpack_decoder_wasm.wasm"
        ));
        for (name, passes) in [
            ("baseline", vec![]),
            ("llvm", vec![]),
            ("o2", vec!["-O2"]),
            ("o3", vec!["-O3"]),
            ("os", vec!["-Os"]),
            ("oz", vec!["-Oz"]),
            (
                "fold",
                vec!["-O3", "--code-folding", "--merge-similar-functions"],
            ),
        ] {
            if std::env::var("OPT_LEVELS").is_ok_and(|levels| !levels.split(',').any(|v| v == name))
            {
                continue;
            }
            let variant = format!("{label}{name}");
            let wasm = dir.join(format!("{profile}-{variant}.wasm"));
            if name == "baseline" {
                fs::copy(&baseline, &wasm)?;
            } else if name == "llvm" {
                fs::copy(&raw, &wasm)?;
            } else {
                let output = Command::new(root.join("node_modules/.bin/wasm-opt"))
                    .arg(&raw)
                    .args([
                        "--mvp-features",
                        "--enable-mutable-globals",
                        "--enable-simd",
                    ])
                    .args(passes)
                    .args([
                        "--converge",
                        "--vacuum",
                        "--strip-dwarf",
                        "--strip-producers",
                        "-o",
                    ])
                    .arg(&wasm)
                    .output()?;
                if !output.status.success() {
                    return Err(String::from_utf8_lossy(&output.stderr).into_owned().into());
                }
            }
            let bytes = fs::read(&wasm)?;
            let source = builder::build_adapter(&options, &bytes)?;
            let module = dir.join(format!("{profile}-{variant}.mjs"));
            fs::write(&module, &source)?;
            rows.push(json!({"profile":profile,"variant":variant,"module":module,"wasm":wasm,"moduleBytes":source.len(),"wasmBytes":bytes.len(),"gzipBytes":transport::gzip9(&bytes)?.len()}));
            println!("{profile}/{name}: {} bytes", source.len());
        }
    }
    manifest["rows"] = json!(rows);
    fs::write(
        dir.join("candidates.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    Ok(())
}
