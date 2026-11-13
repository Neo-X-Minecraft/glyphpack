//! Specialize codec and verification choices into one self-contained ESM.
//! JS handles UTF-8 unpacking; Rust/Wasm handles pair/ANS/Windows and hashes.
//! Required Wasm loads once via gzip/base64; binary() is then synchronous.
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
    ("utf8.js", include_str!("decoder/utf8.js")),
    ("stored.js", include_str!("decoder/stored.js")),
    ("utf8-compact.js", include_str!("decoder/utf8-compact.js")),
    ("compact-core.mjs", include_str!("utf8-compact/decoder.mjs")),
    ("utf8-model.mjs", include_str!("utf8-raw/model.mjs")),
    ("utf8-unpack.mjs", include_str!("utf8-raw/unpack.mjs")),
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
    /// Select smaller BLAKE3 scalar rounds instead of the faster expanded form.
    pub compact_hash: bool,
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
            compact_hash: false,
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
            packings: vec![
                Packing::Pair,
                Packing::Ans,
                Packing::Windows,
                Packing::Utf8,
                Packing::Utf8Compact,
            ],
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
    if !options.data.contains(&Integrity::Secure) {
        options.compact_hash = false;
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
        .filter_map(|p| match p {
            Packing::Pair => Some("pair"),
            Packing::Ans => Some("ans"),
            Packing::Windows => Some("windows"),
            Packing::Utf8 | Packing::Utf8Compact if options.data != [Integrity::None] => {
                Some("utf8")
            }
            Packing::Utf8 | Packing::Utf8Compact => None,
        })
        .collect::<Vec<_>>();
    if options.compact_hash {
        out.push("compact-hash");
    }
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
    out.sort_unstable();
    out.dedup();
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
        "p{}-f{}-d{}-m{}-{}{}",
        options
            .packings
            .iter()
            .map(|p| match p {
                Packing::Pair => 'p',
                Packing::Ans => 'a',
                Packing::Windows => 'w',
                Packing::Utf8 => 'u',
                Packing::Utf8Compact => 'c',
            })
            .collect::<String>(),
        flags(&options.formats),
        options
            .data
            .iter()
            .map(|v| char::from(b'0' + v.kind() as u8))
            .collect::<String>(),
        flags(&options.memory),
        if options.legacy { "legacy" } else { "modern" },
        if options.compact_hash { "-compact" } else { "" }
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
    let mut options = canonical(options)?;
    if options.packings.iter().all(|p| p.is_utf8()) && options.data == [Integrity::None] {
        return Err("This profile needs no Wasm kernel".into());
    }
    // Both JS codecs share one hash-only ABI. Cache by native capabilities,
    // rather than recompiling identical Wasm for every JS codec subset.
    let js_hash = options.packings.iter().any(|p| p.is_utf8()) && options.data != [Integrity::None];
    options.packings.retain(|p| !p.is_utf8());
    if js_hash {
        options.packings.push(Packing::Utf8);
    }
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
    // Pair-only modules favor their small-message path. O3 avoids O4's IR
    // flattening there; broader codec builds retain O4's scheduling/size balance.
    let optimize_level = if options.packings == [Packing::Pair] {
        "-O3"
    } else {
        "-O4"
    };
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
    source.extend_from_slice(b"wasm32v1-none:chrome109:simd128-mutable:atomic-cache-v4");
    source.extend_from_slice(optimize_level.as_bytes());
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
        .arg(optimize_level)
        .args([
            "--mvp-features",
            "--enable-mutable-globals",
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
    let options = canonical(options)?;
    if options.packings.iter().all(|p| p.is_utf8()) && options.data == [Integrity::None] {
        return build_adapter(&options, &[]);
    }
    let wasm = io(fs::read(build_wasm(&options)?))?;
    build_adapter(&options, &wasm)
}

/// Bundle a matching kernel into an independent ESM. Separating assembly from
/// compilation lets experiments compare kernels through the identical adapter.
pub fn build_adapter(options: &BuildOptions, wasm: &[u8]) -> Result<String, String> {
    let options = canonical(options)?;
    let has_utf8 = options.packings.contains(&Packing::Utf8);
    let has_wasm =
        options.packings.iter().any(|p| !p.is_utf8()) || options.data != [Integrity::None];
    let has_compact = options.packings.contains(&Packing::Utf8Compact);
    let payload = if has_wasm {
        transport::base64(&transport::gzip9(wasm)?)
    } else {
        String::new()
    };
    let mut imports = if has_wasm {
        String::from(
        "import {runWasm,warmWasm,failure} from './wasm-runtime.js';\nimport {loadWasm} from './loader.js';\n",
    )
    } else {
        String::from("import{failure}from './wasm-runtime.js';\n")
    };
    if has_utf8 {
        imports.push_str("import{runUtf8,warmUtf8}from './utf8.js';\n");
    }
    if has_compact {
        imports.push_str("import{runCompact,warmCompact}from './utf8-compact.js';\n");
    }
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
    // priority pair > ANS > Windows > UTF-8 > compact UTF-8; never heavy implicitly.
    let cases = options
        .packings
        .iter()
        .map(|p| format!("codec==={:?}?{}:", p.name(), 1u32 << *p as u32))
        .collect::<String>();
    let heavy = if options.packings.contains(&Packing::Pair) {
        "if(flag&&bit===1)heavy|=1;"
    } else {
        ""
    };
    let default_codec = options.packings[0].name();
    let warm_dispatch = format!(
        "{}{}",
        if has_wasm {
            "warmWasm(api,mask&7,heavy);"
        } else {
            ""
        },
        if has_utf8 {
            "if(mask&8)warmUtf8();"
        } else {
            ""
        }
    );
    let warm_dispatch = format!(
        "{}{}",
        warm_dispatch,
        if has_compact {
            "if(mask&16)warmCompact();"
        } else {
            ""
        }
    );
    let warmup=format!("export function warmup(codecs,memoryHeavy){{\nif(codecs===undefined)codecs=[{default_codec:?}];\nif(!Array.isArray(codecs))throw TypeError('Expected an array of payload codecs');\nif(memoryHeavy!==undefined){{if(!Array.isArray(memoryHeavy))throw TypeError('Expected an array of memory flags');if(memoryHeavy.length!==codecs.length)throw Error('Warm-up lists must have the same length');}}\nlet mask=0,heavy=0;\nfor(let i=0;i<codecs.length;i++){{const codec=codecs[i],bit={cases}0;if(!bit)throw failure(9);\nconst flag=memoryHeavy===undefined?false:memoryHeavy[i];\nif(typeof flag!=='boolean')throw TypeError('Expected boolean memory flags');\nmask|=bit;{heavy}}}\n{warm_dispatch}\n}}\n");
    let initialization = if has_wasm {
        format!("const api=await loadWasm({payload:?});")
    } else {
        "const api=null;".into()
    };
    let dispatch = if has_utf8 {
        format!("if(text.charCodeAt(0)===11)return runUtf8(api,text,{format},{data});\n")
    } else {
        "if(text.charCodeAt(0)===11)throw failure(9);\n".into()
    };
    let dispatch = format!(
        "{}{}",
        dispatch,
        if has_compact {
            format!("if(text.charCodeAt(0)===14)return runCompact(api,text,{format},{data});\n")
        } else {
            "if(text.charCodeAt(0)===14)throw failure(9);\n".into()
        }
    );
    let rest = if options.packings.iter().any(|p| !p.is_utf8()) {
        format!("return runWasm(api,text,{format},{data},{memory});")
    } else {
        "throw failure(9);".into()
    };
    let mut raw_exports = String::new();
    if options.formats.contains(&true) && options.data.contains(&Integrity::None) {
        if has_utf8 {
            raw_exports.push_str(
                "export function decodeRawUtf8(text){return runUtf8(api,String.fromCharCode(11,48)+text,true,0);}\n",
            );
        }
        if has_compact {
            raw_exports.push_str("export function decodeRawUtf8Compact(text){return runCompact(api,String.fromCharCode(14,48)+text,true,0);}\n");
        }
    }
    let entry=format!("{imports}\n{initialization}\n{warmup}{raw_exports}export function binary({parameters}){{\n{}\nif(text.length<2)throw failure(2);\n{dispatch}{rest}\n}}\n",statements.join("\n"));
    let scratch = Scratch::new()?;
    for &(name, contents) in FILES {
        let contents = contents.replace("\"./model.mjs\"", "\"./utf8-model.mjs\"");
        io(fs::write(scratch.0.join(name), contents))?;
    }
    let defines = [
        (
            "UTF8_FORMAT_RUNTIME",
            (options.formats.len() > 1).to_string(),
        ),
        (
            "UTF8_VERIFY_FORMAT",
            options.formats.contains(&true).to_string(),
        ),
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
    if options.formats.contains(&true) && options.data.contains(&Integrity::None) {
        for (p, name) in [
            (Packing::Utf8, "decodeRawUtf8"),
            (Packing::Utf8Compact, "decodeRawUtf8Compact"),
        ] {
            if options.packings.contains(&p) {
                declaration.push_str(&format!("/** Strict raw transport, without integrity verification. */\nexport declare function {name}(text: string): Uint8Array;\n"));
            }
        }
    }
    Ok(declaration)
}
