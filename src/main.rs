//! Command-line entry point. Binary payload I/O is never routed through a
//! terminal text encoding; stdout contains only the requested output bytes.
use glyphpack::{
    builder::{self, BuildOptions},
    encoder::{self, Effort, EncodeOptions, Integrity},
    injector, tooling,
};
use std::{
    collections::BTreeMap,
    env, fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command,
};

type Result<T> = std::result::Result<T, String>;
fn read(path: &str) -> Result<Vec<u8>> {
    if path == "-" {
        let mut data = Vec::new();
        io::stdin()
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        Ok(data)
    } else {
        fs::read(path).map_err(|e| format!("{path}: {e}"))
    }
}
fn write(path: Option<&str>, data: &[u8]) -> Result<()> {
    match path {
        Some(p) if p != "-" => {
            let parent = Path::new(p).parent().filter(|p| !p.as_os_str().is_empty());
            if let Some(parent) = parent {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(p, data).map_err(|e| e.to_string())
        }
        _ => io::stdout().write_all(data).map_err(|e| e.to_string()),
    }
}
fn next<'a>(args: &'a [String], at: &mut usize) -> Result<&'a str> {
    *at += 1;
    args.get(*at)
        .map(String::as_str)
        .ok_or("Missing option value".into())
}
fn switches(args: &[String], at: &mut usize) -> Result<Vec<String>> {
    let mut values = Vec::new();
    while *at + 1 < args.len() && !args[*at + 1].starts_with('-') {
        *at += 1;
        values.extend(args[*at].split(',').map(str::to_string));
    }
    if values.is_empty() {
        return Err("Missing selected choices".into());
    }
    Ok(values)
}
fn booleans(values: Vec<String>) -> Result<Vec<bool>> {
    values
        .into_iter()
        .map(|v| match v.as_str() {
            "on" | "true" => Ok(true),
            "off" | "false" => Ok(false),
            _ => Err("Expected on or off".into()),
        })
        .collect()
}
fn root() -> Result<PathBuf> {
    glyphpack::project::root()
}

fn main_impl() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("help");
    let args = &args[1.min(args.len())..];
    match command {
        "--version" | "-V" => {
            println!("GlyphPack {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "encode" => {
            let mut options = EncodeOptions::default();
            let (mut input, mut output, mut text) = ("-", None, false);
            let mut at = 0;
            while at < args.len() {
                match args[at].as_str() {
                    "--checksum" | "--data" => {
                        options.integrity = Integrity::parse(next(args, &mut at)?)?
                    }
                    "--mask" => {
                        let s = next(args, &mut at)?;
                        options.mask = Some(
                            if let Some(h) = s.strip_prefix("0x") {
                                u8::from_str_radix(h, 16)
                            } else {
                                s.parse()
                            }
                            .map_err(|_| "mask must be a byte")?,
                        );
                    }
                    "--effort" => {
                        options.effort = match next(args, &mut at)? {
                            "full" => Effort::Full,
                            "fast" => Effort::Fast,
                            _ => return Err("effort must be full or fast".into()),
                        }
                    }
                    "--legacy" => options.legacy = true,
                    "--text" => text = true,
                    "-o" | "--output" => output = Some(next(args, &mut at)?),
                    "-" => input = "-",
                    s if !s.starts_with('-') => input = s,
                    s => return Err(format!("Unknown encode option: {s}")),
                }
                at += 1;
            }
            let data = read(input)?;
            if text {
                write(output, encoder::encode_text(&data, &options)?.as_bytes())
            } else {
                write(output, &encoder::dense16(&data, &options)?)
            }
        }
        "build" => {
            let mut options = BuildOptions::default();
            let (mut at, mut output, mut full, mut selected, mut all) =
                (0, None, false, false, false);
            while at < args.len() {
                match args[at].as_str() {
                    "--data" => {
                        options.data = switches(args, &mut at)?
                            .iter()
                            .map(|v| Integrity::parse(v))
                            .collect::<Result<Vec<_>>>()?;
                        selected = true;
                    }
                    "--format" => {
                        options.formats = booleans(switches(args, &mut at)?)?;
                        selected = true;
                    }
                    "--memory-heavy" => {
                        options.memory = booleans(switches(args, &mut at)?)?;
                        selected = true;
                    }
                    "--no-format-checks" => {
                        options.formats = vec![false];
                        selected = true;
                    }
                    "--legacy" => options.legacy = true,
                    "--full" => full = true,
                    "--all" => all = true,
                    "--readable" => options.minify = false,
                    "--module" => options.module = true,
                    "--esbuild" => options.esbuild = Some(next(args, &mut at)?.into()),
                    "-o" | "--output" => output = Some(next(args, &mut at)?),
                    s => return Err(format!("Unknown build option: {s}")),
                }
                at += 1;
            }
            if full && selected {
                return Err("--full already selects every setting".into());
            }
            if all {
                println!("{}", tooling::profiles::build_all(&root()?)?);
                return Ok(());
            }
            if full {
                options.formats = vec![false, true];
                options.data = vec![Integrity::None, Integrity::Fast, Integrity::Secure];
                options.memory = vec![false, true];
            }
            write(output, builder::build_decoder(&options)?.as_bytes())
        }
        "inject" => {
            if args.len() != 3 {
                return Err(
                    "Usage: glyphpack inject template.html payload.utf16 output.html".into(),
                );
            }
            let template = String::from_utf8(read(&args[0])?).map_err(|e| e.to_string())?;
            let raw = read(&args[1])?;
            if raw.len() % 2 != 0 {
                return Err("UTF-16LE payload has an odd byte count".into());
            }
            let units: Vec<u16> = raw
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            let text = String::from_utf16(&units).map_err(|e| e.to_string())?;
            let element = injector::payload_element("payload", &text, &BTreeMap::new())?;
            let html = injector::inject_html(
                &template,
                &BTreeMap::from([("__PAYLOAD__".into(), element)]),
            )?;
            write(Some(&args[2]), &injector::utf16_document(&html))
        }
        "demo" => {
            let text = encoder::encode_text(
                "Hello from GlyphPack. ✓".as_bytes(),
                &EncodeOptions::default(),
            )?;
            let element = injector::payload_element("payload", &text, &BTreeMap::new())?;
            // The appended demo code calls the local binary binding; keep
            // readable identifiers instead of relying on a minified export alias.
            let decoder = builder::build_decoder(&BuildOptions {
                minify: false,
                ..BuildOptions::default()
            })?;
            let html=format!("<!doctype html><meta charset=\"utf-16le\"><title>GlyphPack</title><output></output>{element}<script type=\"module\">{decoder}\ndocument.querySelector('output').textContent=new TextDecoder().decode(binary(document.getElementById('payload').textContent));</script>");
            write(
                Some(
                    args.first()
                        .map(String::as_str)
                        .unwrap_or("generated/demo.html"),
                ),
                &injector::utf16_document(&html),
            )
        }
        "fixtures" => {
            let path = tooling::fixtures::write_vectors(&root()?)?;
            println!("{}", path.display());
            Ok(())
        }
        "test-js" => {
            let path = tooling::fixtures::write_vectors(&root()?)?;
            for file in [
                "tests/regression.cjs",
                "tests/payload_decoder_test.js",
                "tests/blake3_test.js",
                "tests/wasm.cjs",
            ] {
                let status = Command::new("node")
                    .arg(root()?.join(file))
                    .arg(&path)
                    .current_dir(root()?)
                    .env(
                        "GLYPHPACK_BIN",
                        env::current_exe().map_err(|e| e.to_string())?,
                    )
                    .status()
                    .map_err(|e| e.to_string())?;
                if !status.success() {
                    return Err(format!("JavaScript test failed: {file}"));
                }
            }
            Ok(())
        }
        "bench" => {
            if args.first().is_some_and(|s| s == "smoke") {
                tooling::fixtures::write_vectors(&root()?)?;
            }
            tooling::benchmark::run(&root()?, args)
        }
        "site" => {
            let out = match args {
                [] => root()?.join("generated/pages"),
                [flag, path] if flag == "--output" => PathBuf::from(path),
                _ => return Err("Usage: glyphpack site [--output directory]".into()),
            };
            tooling::site::build(&root()?, &out)
        }
        "summary" => match args {
            [] => tooling::summary::compact(&root()?),
            [input_flag, input, output_flag, output]
                if input_flag == "--input" && output_flag == "--output" =>
            {
                tooling::report::write(Path::new(input), Path::new(output))
            }
            _ => Err("Usage: glyphpack summary [--input CSV --output directory]".into()),
        },
        "help" | "--help" | "-h" => {
            println!("GlyphPack\n\n  encode [input|-] [--checksum secure|fast|none] [--mask N] [--text] [-o path]\n  build [--full|--all] [--format on off] [--data none fast secure]\n        [--memory-heavy off on] [--module] [--readable] [-o path]\n  inject template.html payload.utf16 output.html\n  demo [output.html]\n  fixtures\n  test-js\n  bench prepare|run|smoke [--quick]\n  site [--output directory]\n  summary");
            Ok(())
        }
        s => Err(format!("Unknown command: {s}")),
    }
}
fn main() {
    if let Err(error) = main_impl() {
        eprintln!("glyphpack: {error}");
        std::process::exit(1);
    }
}
