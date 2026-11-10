//! Experimental ESM only: freeze the reference decoder and swap its hash factory.
//! Rejected prototype kept for reproduction; production retains a single Wasm
//! decode/verify call and does not rewrite or ship this JavaScript reference.
use glyphpack::transport::{base64, gzip9};
use std::{env, fmt::Write as _, fs, path::Path, process::Command};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--prepare") {
        return prepare();
    }
    let wasm = fs::read(&args[0])?;
    let minimum: usize = args.get(2).map(|v| v.parse()).transpose()?.unwrap_or(0);
    let decoder = fs::read_to_string("tests/reference/full.js")?;
    assert_eq!(decoder.matches("function rt(){").count(), 1);
    let decoder = decoder.replacen("function rt(){", "function createOriginalHash(){", 1)
        .replacen("(()=>{", &format!("(()=>{{function rt(){{let fallback;return (bytes,end)=>simdApi&&end>={minimum}?wasmHash(bytes,end):(fallback||(fallback=createOriginalHash()))(bytes,end);}}"), 1);
    let loader = fs::read_to_string("benchmarks/experiments/hybrid/hash-loader.js")?;
    let source = format!(
        "const wasmPayload=\"{}\";\n{loader}\n{decoder}\nexport {{binary}};\n",
        base64(&gzip9(&wasm).map_err(std::io::Error::other)?)
    );
    fs::write(&args[1], source)?;
    Ok(())
}

// Generate experimental sources in ignored scratch space, keeping production
// files untouched. All external commands receive structured arguments.
fn prepare() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let work = root.join("generated/performance");
    let source = work.join("sources");
    fs::create_dir_all(source.join("hash"))?;
    if !root.join("generated/history/manifest.json").is_file() {
        glyphpack::tooling::history::prepare(root, None, None, false)
            .map_err(std::io::Error::other)?;
    }
    let git = |name: &str| -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let output = Command::new("git")
            .args(["show", name])
            .current_dir(root)
            .output()?;
        if !output.status.success() {
            return Err(std::io::Error::other(
                String::from_utf8_lossy(&output.stderr).into_owned(),
            )
            .into());
        }
        Ok(output.stdout)
    };
    fs::write(work.join("baseline.mjs"), git("v0.2.0:dist/full.min.mjs")?)?;
    let abi = fs::read_to_string(root.join("benchmarks/fixtures/rust-hashes.rs"))?
        .replace("../../src/hash.rs", "hash.rs");
    fs::write(source.join("hash-abi.rs"), abi)?;
    let compile = |name: &str, simd: bool| -> Result<(), Box<dyn std::error::Error>> {
        let mut command = Command::new("rustc");
        command.args([
            "--edition=2021",
            "--crate-type=cdylib",
            "--target=wasm32v1-none",
            "-Copt-level=3",
            "-Clto=fat",
            "-Cpanic=abort",
            "-Cstrip=symbols",
            "-Clink-arg=-zstack-size=65536",
        ]);
        if simd {
            command.arg("-Ctarget-feature=+simd128");
        }
        if !command
            .arg(source.join("hash-abi.rs"))
            .arg("-o")
            .arg(work.join(name))
            .status()?
            .success()
        {
            return Err(std::io::Error::other("Hash experiment compilation failed").into());
        }
        Ok(())
    };
    fs::write(source.join("hash.rs"), git("v0.2.0:src/hash.rs")?)?;
    compile("hashes-baseline.wasm", false)?;
    let current = fs::read(root.join("src/hash.rs"))?;
    let loop_source = fs::read_to_string(root.join("src/hash/simd.rs"))?;
    fs::write(source.join("hash.rs"), current)?;
    fs::write(source.join("hash/simd.rs"), &loop_source)?;
    compile("hashes-unrolled.wasm", false)?;
    compile("hashes-simd-loop.wasm", true)?;
    let begin = loop_source
        .find("        for round in 0..7 {")
        .ok_or("SIMD round marker missing")?;
    let end = loop_source[begin..]
        .find("        for i in 0..8 {")
        .ok_or("SIMD result marker missing")?
        + begin;
    let mut schedule: Vec<usize> = (0..16).collect();
    let permutation = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
    let mut rounds = String::new();
    for _ in 0..7 {
        writeln!(
            rounds,
            "        round!({});",
            schedule
                .iter()
                .map(usize::to_string)
                .collect::<Vec<_>>()
                .join(",")
        )?;
        schedule = permutation.map(|i| schedule[i]).to_vec();
    }
    fs::write(
        source.join("hash/simd.rs"),
        format!("{}{}{}", &loop_source[..begin], rounds, &loop_source[end..]),
    )?;
    compile("hashes-simd.wasm", true)?;
    fs::write(source.join("hash/simd.rs"), loop_source)?;
    println!("Prepared component modules in {}", work.display());
    Ok(())
}
