//! 0BSD, NeoX. Separate physical charset, codec, payload and decoder costs.
use serde_json::Value;
use std::{fmt::Write as _, fs, path::Path};
const DIR: &str = "generated/transports";
fn load(f: &str) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(serde_json::from_slice(&fs::read(Path::new(DIR).join(f))?)?)
}
fn a(v: &Value) -> &[Value] {
    v.as_array().unwrap()
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn n(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap()
}
fn med(mut x: Vec<f64>) -> f64 {
    x.sort_by(f64::total_cmp);
    (x[(x.len() - 1) / 2] + x[x.len() / 2]) / 2.
}
pub fn write() -> Result<(), Box<dyn std::error::Error>> {
    let m = load("manifest.json")?;
    let docs = load("documents.json")?;
    let check = load("checks.json")?;
    let protocol = load("protocol.json")?;
    let compat = load("compat.json")?;
    let cold = load("cold.json")?;
    let r156 = load("main-156.json")?;
    let r109 = load("main-109.json")?;
    for v in [&check, &protocol, &compat, &cold, &r156, &r109] {
        assert_eq!(v["pass"], true)
    }
    assert_eq!(r156["manifestSha256"], r109["manifestSha256"]);
    for r in [&r156, &r109] {
        for module in a(&r["modules"]) {
            assert_eq!(check["hashes"][s(module, "name")], module["sha256"])
        }
    }
    let out = Path::new("benchmarks/experiments/transports/results");
    fs::create_dir_all(out)?;
    for f in [
        "main-156.json",
        "main-109.json",
        "checks.json",
        "protocol.json",
        "compat.json",
        "cold.json",
    ] {
        fs::write(out.join(f), serde_json::to_vec(&load(f)?)?)?;
    }
    fs::write(
        out.join("documents.json"),
        serde_json::to_vec_pretty(&docs)?,
    )?;
    let mut csv=String::from("browser,codec,dataset,input_bytes,source_bytes,source_overhead_pct,median_ms,process_min_ms,process_max_ms,retained_wasm_bytes\n");
    for r in [&r156, &r109] {
        for row in a(&r["summary"]) {
            let mem = a(&r["rows"])
                .iter()
                .filter(|x| x["name"] == row["name"] && x["dataset"] == row["dataset"])
                .map(|x| x["wasmRetainedBytes"].as_u64().unwrap())
                .max()
                .unwrap();
            writeln!(
                csv,
                "{},{},{},{},{},{:.6},{:.6},{:.6},{:.6},{mem}",
                s(r, "browser"),
                s(row, "name"),
                s(row, "dataset"),
                row["bytes"],
                row["sourceBytes"],
                (n(row, "sourceBytes") / n(row, "bytes") - 1.) * 100.,
                n(row, "ms"),
                n(row, "runMin"),
                n(row, "runMax")
            )?;
        }
    }
    fs::write(out.join("timings.csv"), csv)?;
    let mut summary=String::from("codec,input_bytes,source_bytes,source_overhead_pct,html_bytes,html_overhead_pct,decode_156_ms,decode_109_ms,ready_156_ms,ready_109_ms,retained_wasm_bytes\n");
    let mut md=String::from("# Charset and packing migration decision\n\nAll HTML uses the same inert raw-script container. The pair and UTF-16 ANS candidates share the 63,385-symbol production alphabet. Windows candidates use 254 or 253 single-byte source symbols. All use the production allocator, selected XOR mask, BLAKE3, output ownership and JS/Wasm adapter. These experiments do not change production defaults.\n\n[Four-row summary CSV](compact.csv) · [All decode timings](timings.csv) · [Migration policy sizes](migration-sizes.csv)\n\n## 10 MiB random input, BLAKE3\n\nSource includes headers and trailers. Complete HTML includes the real decoder, loader, framing and BOM where applicable. Retained Wasm memory is capacity after a call, not peak application memory. Values are medians of three independent processes.\n\n| Mode | Source overhead | HTML bytes | Decode 156 | Decode 109 | Ready 156 | Ready 109 | Wasm MiB |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n");
    for name in ["pair-control", "ans4", "windows254", "windows253"] {
        let d = a(&docs)
            .iter()
            .find(|d| d["name"] == name && d["dataset"] == "random-10MiB")
            .unwrap();
        let ra = a(&r156["summary"])
            .iter()
            .find(|r| r["name"] == name && r["dataset"] == "random-10MiB")
            .unwrap();
        let rb = a(&r109["summary"])
            .iter()
            .find(|r| r["name"] == name && r["dataset"] == "random-10MiB")
            .unwrap();
        let cr = |browser: &str| {
            med(a(&cold["rows"])
                .iter()
                .filter(|r| {
                    r["name"] == name
                        && r["dataset"] == "random-10MiB"
                        && s(r, "browser").starts_with(browser)
                })
                .map(|r| n(r, "readyMs"))
                .collect())
        };
        let mem = a(&r156["rows"])
            .iter()
            .find(|r| r["name"] == name && r["dataset"] == "random-10MiB")
            .unwrap()["wasmRetainedBytes"]
            .as_u64()
            .unwrap();
        let source = (n(d, "sourceBytes") / n(d, "bytes") - 1.) * 100.;
        let total = (n(d, "htmlBytes") / n(d, "bytes") - 1.) * 100.;
        writeln!(
            summary,
            "{name},{},{},{source:.6},{},{total:.6},{:.4},{:.4},{:.4},{:.4},{mem}",
            d["bytes"],
            d["sourceBytes"],
            d["htmlBytes"],
            n(ra, "ms"),
            n(rb, "ms"),
            cr("156."),
            cr("109.")
        )?;
        writeln!(
            md,
            "| {name} | {source:.4}% | {} | {:.1} ms | {:.1} ms | {:.1} ms | {:.1} ms | {:.2} |",
            d["htmlBytes"],
            n(ra, "ms"),
            n(rb, "ms"),
            cr("156."),
            cr("109."),
            mem as f64 / 1048576.
        )?;
    }
    fs::write(out.join("compact.csv"), summary)?;
    // Derive migration costs for three actual public module policies. This
    // budget deliberately excludes the few framing/entry bytes: it is exact
    // payload source + verbatim ESM source stored in a UTF-16 document, not an
    // assertion that these public exports are already a complete HTML wrapper.
    let old: Value = serde_json::from_slice(&fs::read("generated/compact/builds.json")?)?;
    let mut migration=String::from("policy,dataset,input_bytes,pair_source_bytes,ans4_source_bytes,pair_module_bytes,ans4_module_bytes,ans4_utf16_budget_delta_bytes,delta_pct_of_input\n");
    md.push_str("\n## Small-file costs\n\nActual complete HTML byte counts. The decoder's source encoding matters most at small payload sizes.\n\n| Input | UTF-16 pair | UTF-16 ANS4 | Windows 254 | Windows 253 |\n| --- | ---: | ---: | ---: | ---: |\n");
    for ds in ["empty", "random-1KiB", "random-1MiB", "random-10MiB"] {
        write!(md, "| {ds} |")?;
        for name in ["pair-control", "ans4", "windows254", "windows253"] {
            let d = a(&docs)
                .iter()
                .find(|d| d["name"] == name && d["dataset"] == ds)
                .unwrap();
            write!(md, " {} |", d["htmlBytes"])?;
        }
        md.push('\n');
    }
    md.push_str("\n## Would ANS always make the UTF-16 file smaller?\n\nNo. Exact source+module budgets below count the actual payload plus twice the ESM bytes, excluding HTML glue. Positive deltas mean ANS is larger. Core is unchecked/no hash; full contains all 12 runtime choices and is evaluated with secure payloads.\n\n| Input | Secure specialization delta | Full-policy module delta | Core/no-hash delta |\n| --- | ---: | ---: | ---: |\n");
    for ds in [
        "random-1KiB",
        "random-1MiB",
        "random-10MiB",
        "json-logs",
        "zeros-1MiB",
        "utf8-text",
        "gzip-logs",
        "decoder-wasm",
    ] {
        write!(md, "| {ds} |")?;
        for (policy, pair, ans, kind) in [
            ("secure", "pair-control", "ans4", 2),
            ("full", "pair-control-full", "ans4-full", 2),
            ("core", "pair-control-core", "ans4-core", 0),
        ] {
            let r = a(&m["rows"])
                .iter()
                .find(|r| r["dataset"] == ds && r["kind"] == kind)
                .unwrap();
            let p = n(&r["packets"]["pair"], "sourceBytes");
            let q = n(&r["packets"]["ans4"], "sourceBytes");
            let module = |name: &str| {
                n(
                    a(&old).iter().find(|r| r["name"] == name).unwrap(),
                    "moduleBytes",
                )
            };
            let pb = module(pair);
            let qb = module(ans);
            let delta = (q - p + 2. * (qb - pb)) as i64;
            writeln!(
                migration,
                "{policy},{ds},{},{},{},{},{},{delta},{:.6}",
                r["bytes"],
                p as u64,
                q as u64,
                pb as u64,
                qb as u64,
                delta as f64 / n(r, "bytes") * 100.
            )?;
            write!(md, " {delta} B |")?;
        }
        md.push('\n');
    }
    fs::write(out.join("migration-sizes.csv"), migration)?;
    md.push_str("\n## Compatibility observations\n\nBoth browsers passed correct and absent HTTP charsets. With a deliberate UTF-8 HTTP header, both Windows files failed, while every UTF-16 file with its BOM succeeded. Escaped Unicode page titles and JS strings worked in both charsets. Literal Chinese/emoji source cannot be represented directly in Windows-1252; HTML entities and JS Unicode escapes preserve full displayed Unicode. These are source/transport constraints, not an inability to display Unicode.\n\nThe same Windows-alphabet codec also works after correct UTF-8 transcoding, but the physical size advantage vanishes:\n\n| File | Windows source bytes | UTF-8 transcode bytes |\n| --- | ---: | ---: |\n");
    for r in a(&compat["transcodes"]) {
        writeln!(
            md,
            "| {} | {} | {} |",
            s(r, "name"),
            r["originalBytes"],
            r["utf8Bytes"]
        )?;
    }
    md.push_str("\n## Alphabet bounds\n\nFor uniformly random long inputs, before framing and finite-state overhead:\n\n| Alphabet / storage | Information bound on expansion |\n| --- | ---: |\n");
    for (r, bits) in [(63385f64, 16f64), (254f64, 8f64), (253f64, 8f64)] {
        writeln!(
            md,
            "| {} symbols / {}-bit source | {:.6}% |",
            r as u64,
            bits as u64,
            (bits / r.log2() - 1.) * 100.
        )?;
    }
    md.push_str("\nThis is an asymptotic uniform-input alphabet bound, not a bound on every input's entropy. The present uniform ANS model closely approaches it. The pair codec can have lower expansion on nonuniform inputs through data-dependent 31/32-bit choices and XOR selection. Neither codec changes UTF-16LE's browser capabilities.\n\n");
    md.push_str(include_str!("notes.md"));
    fs::write(out.join("RESULTS.md"), md)?;
    println!("Wrote transport and migration analysis");
    Ok(())
}
