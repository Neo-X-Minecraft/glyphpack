//! 0BSD, NeoX. Native preparation for the fast UTF-8 prefix experiment.
//! No production wire format is changed. The raw transport has no digest.
//! Default portable build uses fixed profile 5; --all-profiles is for research.
use serde_json::json;
use std::{
    fmt::Write,
    fs,
    io::Write as IoWrite,
    path::Path,
    process::{Command, Stdio},
};
const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const PROFILES: [&[u8]; 6] = [
    &[0, 10, 13, 34, 38, 60, 92],
    &[0, 10, 13, 34, 38, 60, 92, 127],
    &[0, 10, 13, 34, 38, 60, 92, 96, 127],
    &[0, 10, 13, 34, 38, 39, 60, 92, 96, 127],
    &[0, 10, 13, 34, 36, 38, 39, 60, 92, 96, 127],
    &[0, 10, 13, 34, 36, 39, 60, 92, 96, 127],
];
// Frozen version-1 alphabet. Each range contains only assigned two-byte scalars
// with stable NFC spelling and no combining marks or Unicode format controls.
const PORTABLE_RANGES: [(u16, u16); 37] = [
    (160, 173),
    (174, 768),
    (880, 884),
    (885, 888),
    (890, 894),
    (895, 896),
    (900, 903),
    (904, 907),
    (908, 909),
    (910, 930),
    (931, 1155),
    (1162, 1328),
    (1329, 1367),
    (1369, 1419),
    (1421, 1424),
    (1470, 1471),
    (1472, 1473),
    (1475, 1476),
    (1478, 1479),
    (1488, 1515),
    (1519, 1525),
    (1542, 1552),
    (1563, 1564),
    (1565, 1611),
    (1632, 1648),
    (1649, 1750),
    (1758, 1759),
    (1765, 1767),
    (1769, 1770),
    (1774, 1806),
    (1808, 1809),
    (1810, 1840),
    (1869, 1958),
    (1969, 1970),
    (1984, 2027),
    (2036, 2043),
    (2046, 2048),
];
const PORTABLE: [u16; 1547] = {
    let mut out = [0; 1547];
    let mut n = 0;
    let mut i = 0;
    while i < PORTABLE_RANGES.len() {
        let mut c = PORTABLE_RANGES[i].0;
        while c < PORTABLE_RANGES[i].1 {
            out[n] = c;
            n += 1;
            c += 1;
        }
        i += 1;
    }
    out
};
struct Model {
    blocked: [u8; 128],
    portable: bool,
    radix: usize,
    base: u32,
    cut: usize,
}
impl Model {
    fn new(profile: usize) -> Self {
        let forbidden = PROFILES[profile];
        let mut blocked = [0u8; 128];
        for (index, &c) in forbidden.iter().enumerate() {
            blocked[c as usize] = index as u8 + 1;
        }
        let radix = (if profile == 5 { 1547 } else { 1888 } / forbidden.len()).min(256);
        let base = radix.ilog2();
        Self {
            blocked,
            portable: profile == 5,
            radix,
            base,
            cut: (1 << (base + 1)) - radix,
        }
    }
}
struct Reader<'a> {
    data: &'a [u8],
    mask: u8,
    at: usize,
    queue: u32,
    bits: u32,
    consumed: usize,
}
impl Reader<'_> {
    fn read(&mut self, count: u32) -> u32 {
        // Read a whole byte when needed, instead of advancing a bit at a time.
        // Only real input bytes are XORed; synthetic final padding remains zero.
        while self.bits < count {
            self.queue =
                (self.queue << 8) | u32::from(self.data.get(self.at).map_or(0, |&b| b ^ self.mask));
            self.at += 1;
            self.bits += 8;
        }
        self.bits -= count;
        self.consumed += count as usize;
        (self.queue >> self.bits) & ((1 << count) - 1)
    }
}
fn body(data: &[u8], model: &Model, mask: u8, mut emit: impl FnMut(u16)) {
    let mut reader = Reader {
        data,
        mask,
        at: 0,
        queue: 0,
        bits: 0,
        consumed: 0,
    };
    while reader.consumed < data.len() * 8 {
        let first = reader.read(7) as u8;
        let index = model.blocked[first as usize];
        if index != 0 {
            let mut tail = reader.read(model.base) as usize;
            if tail >= model.cut {
                tail = tail * 2 + reader.read(1) as usize - model.cut;
            }
            let digit = (index as usize - 1) * model.radix + tail;
            emit(if model.portable {
                PORTABLE[digit]
            } else {
                (160 + digit) as u16
            });
        } else {
            emit(u16::from(first));
        }
    }
}
fn score(data: &[u8], model: &Model, mask: u8) -> usize {
    let mut n = 0;
    body(data, model, mask, |c| n += if c < 128 { 1 } else { 2 });
    n
}
fn choose_mask(data: &[u8], model: &Model) -> u8 {
    // Rank all masks on bounded prefix/suffix samples, then recount the best
    // four and mask zero on the complete data. The winner cannot make a file
    // larger than its unmasked encoding. Ties choose the lowest mask byte.
    let sample = if data.len() > 4096 {
        [&data[..2048], &data[data.len() - 2048..]].concat()
    } else {
        data.to_vec()
    };
    let mut scores: Vec<_> = (0..=255u8)
        .map(|mask| (score(&sample, model, mask), mask))
        .collect();
    scores.sort_unstable();
    let mut candidates = vec![0];
    for &(_, mask) in scores.iter().take(4) {
        if !candidates.contains(&mask) {
            candidates.push(mask);
        }
    }
    candidates
        .into_iter()
        .min_by_key(|&mask| (score(data, model, mask), mask))
        .unwrap()
}
fn encode(data: &[u8], profile: usize, mask: u8) -> String {
    let mut out = String::with_capacity(data.len() + data.len().div_ceil(7) + 32);
    write!(
        &mut out,
        "~u1{}{}{}",
        A[profile] as char,
        A[(mask & 63) as usize] as char,
        A[(mask >> 6) as usize] as char
    )
    .unwrap();
    let mut length = data.len();
    loop {
        let digit = (length & 31) | if length >= 32 { 32 } else { 0 };
        out.push(A[digit] as char);
        length >>= 5;
        if length == 0 {
            break;
        }
    }
    body(data, &Model::new(profile), mask, |c| {
        out.push(char::from_u32(u32::from(c)).unwrap())
    });
    out
}
fn decoder(
    classic: bool,
    portable: bool,
    balanced: bool,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let root = std::env::current_dir()?;
    let mut command = Command::new(root.join("node_modules/.bin/esbuild"));
    command.args([
        "--bundle",
        "--loader=js",
        "--minify",
        "--target=chrome109",
        "--legal-comments=none",
    ]);
    command.arg(if portable {
        "--define:PREFIX_PORTABLE_ONLY=true"
    } else {
        "--define:PREFIX_PORTABLE_ONLY=false"
    });
    if classic {
        command.arg("--format=iife");
    } else {
        command.arg("--format=esm");
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    // Pick the loop at build time. No second implementation or engine-guessing
    // branch enters the delivered module; both loops decode the same wire data.
    let entry = if balanced {
        "prefix-split"
    } else {
        "prefix-throughput"
    };
    let source = if classic {
        format!("import {{binary}} from './benchmarks/experiments/utf8/{entry}.mjs';import {{warmup}} from './benchmarks/experiments/utf8/prefix.mjs';globalThis.UTF8Prefix={{decode:binary,warmup}};")
    } else {
        format!("export {{binary as decode}} from './benchmarks/experiments/utf8/{entry}.mjs';export {{warmup}} from './benchmarks/experiments/utf8/prefix.mjs';")
    };
    child.stdin.take().unwrap().write_all(source.as_bytes())?;
    let result = child.wait_with_output()?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).into_owned().into());
    }
    Ok(result.stdout)
}
fn save(path: &str, bytes: impl AsRef<[u8]>) -> std::io::Result<()> {
    if let Some(parent) = Path::new(path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "build") {
        let output = args.get(1).ok_or(
            "Usage: utf8_prefix build output.mjs [--classic] [--all-profiles] [--balanced]",
        )?;
        for flag in &args[2..] {
            if flag != "--classic" && flag != "--all-profiles" && flag != "--balanced" {
                return Err(format!("Unknown build option: {flag}").into());
            }
        }
        save(
            output,
            decoder(
                args.iter().any(|a| a == "--classic"),
                !args.iter().any(|a| a == "--all-profiles"),
                args.iter().any(|a| a == "--balanced"),
            )?,
        )?;
        return Ok(());
    }
    if args.first().is_some_and(|a| a == "encode" || a == "html") {
        let (Some(input), Some(output)) = (args.get(1), args.get(2)) else {
            return Err(
                "Usage: utf8_prefix encode|html input output [--profile portable|literal|compact|0..5] [--mask 0..255] [--balanced (html only)]"
                    .into(),
            );
        };
        let mut profile = 5;
        let mut mask = None;
        let mut balanced = false;
        let mut i = 3;
        while i < args.len() {
            match args[i].as_str() {
                "--profile" => {
                    i += 1;
                    profile = match args.get(i).ok_or("Missing profile")?.as_str() {
                        "portable" => 5,
                        "literal" => 4,
                        "compact" => 0,
                        value => value.parse::<usize>()?,
                    };
                }
                "--mask" => {
                    i += 1;
                    mask = Some(args.get(i).ok_or("Missing mask")?.parse::<u8>()?);
                }
                "--balanced" if args[0] == "html" => balanced = true,
                _ => return Err("Unknown option".into()),
            }
            i += 1;
        }
        if profile >= PROFILES.len() {
            return Err("Unsupported UTF-8 profile".into());
        }
        let data = fs::read(input)?;
        if data.len() > 0x40000000 {
            return Err("Payload too large".into());
        }
        let mask = mask.unwrap_or_else(|| choose_mask(&data, &Model::new(profile)));
        let encoded = encode(&data, profile, mask);
        if args[0] == "html" {
            let code = String::from_utf8(decoder(true, profile == 5, balanced)?)?;
            let html=format!("\u{feff}<!doctype html><meta charset=utf-8><script>{code}globalThis.unpacked=UTF8Prefix.decode(\"{encoded}\");</script>");
            save(output, html)?;
        } else {
            save(output, encoded)?;
        }
        return Ok(());
    }
    if !args.is_empty() && args != ["prepare"] {
        return Err("Use encode, html, build or prepare".into());
    }
    let dir = Path::new("generated/utf8-prefix");
    fs::create_dir_all(dir)?;
    let inputs: serde_json::Value =
        serde_json::from_slice(&fs::read("generated/encoding-comparison/inputs.json")?)?;
    let mut rows = Vec::new();
    for r in inputs.as_array().unwrap().iter().filter(|r| {
        matches!(
            r["label"].as_str(),
            Some("random-1KiB" | "random-64KiB" | "random-1MiB" | "zeros-1MiB" | "sequential-1MiB")
        )
    }) {
        let data = fs::read(r["binary"].as_str().unwrap())?;
        for profile in 0..PROFILES.len() {
            let text = encode(&data, profile, 0);
            let file = dir.join(format!("{}-{profile}.txt", r["label"].as_str().unwrap()));
            fs::write(&file, &text)?;
            rows.push(json!({"label":r["label"],"profile":profile,"inputBytes":data.len(),"sourceBytes":text.len(),"sourceUnits":text.encode_utf16().count(),"file":file,"binary":r["binary"]}));
        }
    }
    let mut cases = Vec::new();
    for n in (0..48).chain([
        63, 64, 65, 127, 128, 129, 1023, 1024, 1025, 4095, 4096, 4097,
    ]) {
        for pattern in 0..4 {
            let mut seed = 815u32;
            let data: Vec<_> = (0..n)
                .map(|i| {
                    seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                    match pattern {
                        0 => (seed >> 24) as u8,
                        1 => 0,
                        2 => 255,
                        _ => i as u8,
                    }
                })
                .collect();
            for profile in 0..PROFILES.len() {
                for mask in [0, 85, 255] {
                    cases.push(json!({"text":encode(&data,profile,mask),"hex":glyphpack::tooling::fixtures::hex(&data)}));
                }
            }
        }
    }
    fs::write(
        dir.join("manifest.json"),
        serde_json::to_vec(&json!({"rows":rows,"cases":cases}))?,
    )?;
    Ok(())
}
