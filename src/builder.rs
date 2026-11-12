//! Build a specialized Rust/Wasm decoder and an independent, self-contained ESM
//! adapter. There is one production backend. Gzip/base64 loading happens once at
//! module evaluation; binary() remains synchronous after import resolves.
use crate::{
    encoder::Integrity, hash::blake3, packing::Packing, tooling::fixtures::hex, transport,
};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
};

const FILES: &[(&str, &str)] = &[
    ("wasm-runtime.js", include_str!("decoder/wasm-runtime.js")),
    ("loader.js", include_str!("decoder/loader.js")),
    ("options.js", include_str!("decoder/options.js")),
    (
        "memory-options.js",
        include_str!("decoder/memory-options.js"),
    ),
];
#[derive(Clone, Debug)]
pub struct BuildOptions {
    pub packings: Vec<Packing>,
    pub formats: Vec<bool>,
    pub data: Vec<Integrity>,
    pub memory: Vec<bool>,
    pub legacy: bool,
    pub minify: bool,
    pub module: bool,
    pub esbuild: Option<PathBuf>,
}
impl Default for BuildOptions {
    fn default() -> Self {
        Self {
            packings: vec![Packing::Pair],
            formats: vec![true],
            data: vec![Integrity::Secure],
            memory: vec![false],
            legacy: false,
            minify: true,
            module: true,
            esbuild: None,
        }
    }
}
impl BuildOptions {
    /// Recommended broader codec coverage with verification fixed on. Memory
    /// overhead stays minimal unless explicitly enabled in a custom build.
    pub fn recommended_full() -> Self {
        Self {
            packings: vec![Packing::Pair, Packing::Ans],
            ..Self::default()
        }
    }
    pub fn full() -> Self {
        Self {
            packings: vec![Packing::Pair, Packing::Ans, Packing::Windows],
            formats: vec![false, true],
            data: vec![Integrity::None, Integrity::Fast, Integrity::Secure],
            memory: vec![false, true],
            ..Self::default()
        }
    }
}
fn io<T>(result: std::io::Result<T>) -> Result<T, String> {
    result.map_err(|e| e.to_string())
}
fn tool(explicit: Option<&Path>, variable: &str, name: &str) -> PathBuf {
    let path = explicit
        .map(Path::to_path_buf)
        .or_else(|| env::var_os(variable).map(PathBuf::from))
        .or_else(|| {
            let p = crate::project::root()
                .ok()?
                .join("node_modules/.bin")
                .join(name);
            p.is_file().then_some(p)
        })
        .unwrap_or_else(|| name.into());
    if path.is_relative() && path.components().count() > 1 {
        env::current_dir().unwrap().join(path)
    } else {
        path
    }
}
pub fn esbuild_path(explicit: Option<&Path>) -> PathBuf {
    tool(explicit, "ESBUILD_BINARY_PATH", "esbuild")
}
fn canonical(options: &BuildOptions) -> Result<BuildOptions, String> {
    let mut options = options.clone();
    options.packings.sort();
    options.packings.dedup();
    options.formats.sort();
    options.formats.dedup();
    options.data.sort();
    options.data.dedup();
    options.memory.sort();
    options.memory.dedup();
    if options.packings.is_empty()
        || options.formats.is_empty()
        || options.data.is_empty()
        || options.memory.is_empty()
    {
        return Err("Every build axis must select at least one choice".into());
    }
    if options.legacy && options.data != [Integrity::None] {
        return Err("Legacy format has no digest; select data=none explicitly".into());
    }
    if options.legacy && options.packings != [Packing::Pair] {
        return Err("Legacy format supports only pair packing".into());
    }
    if !options.packings.contains(&Packing::Pair) {
        options.memory = vec![false]
    }
    if !options.module {
        return Err("The Wasm decoder is an ES module; import it before calling binary()".into());
    }
    Ok(options)
}
fn features(options: &BuildOptions) -> Vec<&'static str> {
    let mut out = options
        .packings
        .iter()
        .map(|p| match p {
            Packing::Pair => "pair",
            Packing::Ans => "ans",
            Packing::Windows => "windows",
        })
        .collect::<Vec<_>>();
    if options.formats.len() > 1 {
        out.push("format-runtime");
    } else if options.formats[0] {
        out.push("format");
    }
    for mode in &options.data {
        out.push(mode.name());
    }
    if options.memory.len() > 1 {
        out.push("memory-runtime");
    } else if options.memory[0] {
        out.push("memory-heavy");
    }
    if options.legacy {
        out.push("legacy");
    }
    out
}
pub fn profile_key(options: &BuildOptions) -> String {
    let flags = |values: &[bool]| {
        values
            .iter()
            .map(|&v| if v { '1' } else { '0' })
            .collect::<String>()
    };
    format!(
        "p{}-f{}-d{}-m{}-{}",
        options
            .packings
            .iter()
            .map(|p| match p {
                Packing::Pair => 'p',
                Packing::Ans => 'a',
                Packing::Windows => 'w',
            })
            .collect::<String>(),
        flags(&options.formats),
        options
            .data
            .iter()
            .map(|v| char::from(b'0' + v.kind() as u8))
            .collect::<String>(),
        flags(&options.memory),
        if options.legacy { "legacy" } else { "modern" }
    )
}
fn version(executable: &Path) -> Result<Vec<u8>, String> {
    let result = io(Command::new(executable).arg("--version").output())?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into());
    }
    Ok(result.stdout)
}

/// Build only the selected policies. Rust feature constants erase absent hashes,
/// format checks and heavy strategies; a cached optimized artifact is reused
/// between readable/minified adapters and repeated builds of the same profile.
pub fn build_wasm(options: &BuildOptions) -> Result<PathBuf, String> {
    let options = canonical(options)?;
    let root = crate::project::root()?;
    let key = profile_key(&options);
    let folder = root.join("generated/wasm/profiles");
    io(fs::create_dir_all(&folder))?;
    let output = folder.join(format!("{key}.wasm"));
    let fingerprint = folder.join(format!("{key}.blake3"));
    let cargo = env::var_os("CARGO")
        .map(PathBuf::from)
        .unwrap_or_else(|| "cargo".into());
    let optimizer = tool(None, "WASM_OPT", "wasm-opt");
    let mut flags = if let Ok(value) = env::var("CARGO_ENCODED_RUSTFLAGS") {
        value.split('\x1f').map(str::to_string).collect::<Vec<_>>()
    } else {
        env::var("RUSTFLAGS")
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_string)
            .collect()
    };
    // SIMD128 is part of the Chrome 109 baseline (Chrome has enabled it since 91).
    // Respect an explicit portable-MVP override without introducing a public
    // runtime option or shipping two kernels. No relaxed SIMD or threads.
    let simd_disabled = flags.iter().any(|flag| {
        flag.split_once("target-feature=")
            .is_some_and(|(_, features)| features.split(',').any(|feature| feature == "-simd128"))
    });
    if !simd_disabled {
        flags.extend(["-C".into(), "target-feature=+simd128".into()]);
    }
    flags.extend(["-C".into(), "link-arg=-zstack-size=65536".into()]);
    let flags = flags.join("\x1f");
    let mut source = features(&options).join(",").into_bytes();
    source.extend_from_slice(b"wasm32v1-none:chrome109:simd128-mutable:-O4:atomic-cache-v3");
    source.extend_from_slice(flags.as_bytes());
    for path in [
        "Cargo.toml",
        "crates/decoder-wasm/Cargo.toml",
        "crates/decoder-wasm/src/lib.rs",
        "crates/decoder-wasm/src/unpack.rs",
        "crates/decoder-wasm/src/ans.rs",
        "crates/decoder-wasm/src/windows.rs",
        "src/packing.rs",
        "src/hash.rs",
        "src/hash/simd.rs",
    ] {
        source.extend(io(fs::read(root.join(path)))?);
    }
    source.extend(
        version(&optimizer)
            .map_err(|e| format!("wasm-opt is required; run npm ci or set WASM_OPT: {e}"))?,
    );
    // Cargo's version tracks the pinned Rust toolchain used for cached builds.
    source.extend(version(&cargo)?);
    let digest = hex(&blake3(&source));
    if output.is_file() && fs::read_to_string(&fingerprint).is_ok_and(|s| s == digest) {
        return Ok(output);
    }
    let target = root.join("generated/wasm/build").join(&key);
    let result = io(Command::new(&cargo)
        .args([
            "build",
            "--locked",
            "--profile",
            "wasm-release",
            "--target",
            "wasm32v1-none",
            "-p",
            "glyphpack-decoder-wasm",
            "--no-default-features",
            "--features",
        ])
        .arg(features(&options).join(","))
        .env("CARGO_ENCODED_RUSTFLAGS", &flags)
        .arg("--target-dir")
        .arg(&target)
        .current_dir(&root)
        .output())?;
    if !result.status.success() {
        return Err(format!(
            "Wasm build failed. Install the wasm32v1-none target.\n{}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    let artifact = target.join("wasm32v1-none/wasm-release/glyphpack_decoder_wasm.wasm");
    // Concurrent builds may request the same profile. Publish only a complete
    // file: Binaryen must never truncate an artifact another caller can read.
    let temporary = folder.join(format!(
        ".{key}-{}-{}.wasm",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut optimize = Command::new(&optimizer);
    optimize
        .arg(&artifact)
        .args([
            "--mvp-features",
            "--enable-mutable-globals",
            "-O4",
            "--converge",
            "--vacuum",
            "--strip-dwarf",
            "--strip-producers",
            "-o",
        ])
        .arg(&temporary);
    if !simd_disabled {
        optimize.arg("--enable-simd");
    }
    let result = io(optimize.output())?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into());
    }
    io(fs::rename(&temporary, &output))?;
    io(fs::write(fingerprint, digest))?;
    Ok(output)
}

static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Result<Self, String> {
        for _ in 0..100 {
            let path = env::temp_dir().join(format!(
                "glyphpack-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("Unable to create decoder build directory".into())
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn build_decoder(options: &BuildOptions) -> Result<String, String> {
    let wasm = io(fs::read(build_wasm(options)?))?;
    build_adapter(options, &wasm)
}

/// Bundle a matching kernel into an independent ESM. Separating assembly from
/// compilation lets experiments compare kernels through the identical adapter.
pub fn build_adapter(options: &BuildOptions, wasm: &[u8]) -> Result<String, String> {
    let options = canonical(options)?;
    let payload = transport::base64(&transport::gzip9(wasm)?);
    let mut imports = String::from(
        "import {runWasm,warmWasm} from './wasm-runtime.js';\nimport {loadWasm} from './loader.js';\n",
    );
    let mut selectors = Vec::new();
    let mut statements = Vec::new();
    let format = if options.formats.len() > 1 {
        selectors.push("selectFormat");
        statements.push("const verifyFormat=selectFormat(options.verifyFormat);");
        "verifyFormat"
    } else if options.formats[0] {
        "true"
    } else {
        "false"
    };
    let kind = *options.data.last().unwrap();
    let fixed_kind = kind.kind().to_string();
    let data = if options.data.len() > 1 {
        selectors.push("selectData");
        statements.push("const dataKind=selectData(options.verifyData);");
        "dataKind"
    } else {
        &fixed_kind
    };
    let memory = if options.memory.len() > 1 {
        imports.push_str("import {selectMemory} from './memory-options.js';\n");
        statements.push("const memoryHeavy=selectMemory(options.memoryHeavy);");
        "memoryHeavy"
    } else if options.memory[0] {
        "true"
    } else {
        "false"
    };
    if !selectors.is_empty() {
        imports.push_str(&format!(
            "import {{{}}} from './options.js';\n",
            selectors.join(",")
        ));
    }
    let parameters = if statements.is_empty() {
        "text"
    } else {
        "text,options={}"
    };
    // Generate only available names. The canonical ordering gives a no-argument
    // priority of pair > ANS > Windows; warm-up never enables heavy implicitly.
    let cases = options
        .packings
        .iter()
        .map(|p| format!("case {:?}:bit={};break;", p.name(), 1u32 << *p as u32))
        .collect::<String>();
    let heavy = if options.packings.contains(&Packing::Pair) {
        "if(flag&&bit===1)heavy|=1;"
    } else {
        ""
    };
    let default_codec = options.packings[0].name();
    let warmup=format!("export function warmup(codecs,memoryHeavy){{\nif(codecs===undefined)codecs=[{default_codec:?}];\nif(!Array.isArray(codecs))throw TypeError('Expected an array of payload codecs');\nif(memoryHeavy!==undefined){{if(!Array.isArray(memoryHeavy))throw TypeError('Expected an array of memory flags');if(memoryHeavy.length!==codecs.length)throw Error('Warm-up lists must have the same length');}}\nlet mask=0,heavy=0;\nfor(let i=0;i<codecs.length;i++){{let bit;switch(codecs[i]){{{cases}default:throw Error('Unsupported payload codec');}}\nconst flag=memoryHeavy===undefined?false:memoryHeavy[i];\nif(typeof flag!=='boolean')throw TypeError('Expected boolean memory flags');\nmask|=bit;{heavy}}}\nwarmWasm(api,mask,heavy);\n}}\n");
    let entry=format!("{imports}\nconst api=await loadWasm({payload:?});\n{warmup}export function binary({parameters}){{\n{}\nreturn runWasm(api,text,{format},{data},{memory});\n}}\n",statements.join("\n"));
    let scratch = Scratch::new()?;
    for &(name, contents) in FILES {
        io(fs::write(scratch.0.join(name), contents))?;
    }
    let defines = [
        (
            "PAYLOAD_ALLOW_PAIR",
            options.packings.contains(&Packing::Pair).to_string(),
        ),
        (
            "PAYLOAD_ALLOW_ANS",
            options.packings.contains(&Packing::Ans).to_string(),
        ),
        (
            "PAYLOAD_ALLOW_WINDOWS",
            options.packings.contains(&Packing::Windows).to_string(),
        ),
        ("PAYLOAD_LEGACY", options.legacy.to_string()),
        (
            "PAYLOAD_VERIFY_FORMAT",
            options.formats.contains(&true).to_string(),
        ),
        (
            "PAYLOAD_INCLUDE_FORMAT",
            options.formats.contains(&true).to_string(),
        ),
        ("PAYLOAD_CHECK_DATA", (kind != Integrity::None).to_string()),
        (
            "PAYLOAD_ALLOW_NONE",
            options.data.contains(&Integrity::None).to_string(),
        ),
        (
            "PAYLOAD_ALLOW_FAST",
            options.data.contains(&Integrity::Fast).to_string(),
        ),
        (
            "PAYLOAD_ALLOW_SECURE",
            options.data.contains(&Integrity::Secure).to_string(),
        ),
        ("PAYLOAD_DEFAULT_DATA", format!("\"{}\"", kind.name())),
        (
            "PAYLOAD_MEMORY_HEAVY",
            (!options.memory.contains(&false)).to_string(),
        ),
    ];
    let mut command = Command::new(esbuild_path(options.esbuild.as_deref()));
    command.args([
        "--loader=js",
        "--sourcefile=decoder.js",
        "--bundle",
        "--format=esm",
        "--target=chrome109",
        "--tree-shaking=true",
        "--legal-comments=none",
    ]);
    for (key, value) in defines {
        command.arg(format!("--define:{key}={value}"));
    }
    command.arg(if options.minify {
        "--minify"
    } else {
        "--minify-syntax"
    });
    let mut child = io(command
        .current_dir(&scratch.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn())?;
    io(child.stdin.take().unwrap().write_all(entry.as_bytes()))?;
    let output = io(child.wait_with_output())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into());
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

/// Emit declarations for the same specialized signature as the JS module.
/// Fixed profiles expose no ignored option fields; only selected runtime axes
/// appear. Declarations are separate assets and add no bytes to the decoder.
pub fn type_declaration(options: &BuildOptions) -> Result<String, String> {
    let options = canonical(options)?;
    let mut fields = Vec::new();
    if options.formats.len() > 1 {
        fields.push("  verifyFormat?: boolean;".to_string());
    }
    if options.data.len() > 1 {
        let mut modes = Vec::new();
        for mode in &options.data {
            modes.push(format!("'{}'", mode.name()));
            if *mode == Integrity::None {
                modes.push("false".into());
            }
            if *mode == Integrity::Secure {
                modes.push("true".into());
            }
        }
        fields.push(format!("  verifyData?: {};", modes.join(" | ")));
    }
    if options.memory.len() > 1 {
        fields.push("  memoryHeavy?: boolean;".to_string());
    }
    let header = "// Generated GlyphPack declaration; policies match this specialized module.\n";
    let mut declaration = if fields.is_empty() {
        format!("{header}export declare function binary(text: string): Uint8Array;\n")
    } else {
        format!("{header}export interface DecodeOptions {{\n{}\n}}\nexport declare function binary(text: string, options?: DecodeOptions): Uint8Array;\n",fields.join("\n"))
    };
    let names = options
        .packings
        .iter()
        .map(|p| format!("'{}'", p.name()))
        .collect::<Vec<_>>()
        .join(" | ");
    declaration.push_str(&format!("export declare function warmup(codecs?: readonly ({names})[], memoryHeavy?: readonly boolean[]): void;\n"));
    Ok(declaration)
}
