//! 0BSD, NeoX. Aggregate exact artifacts, matched runtime policies and actual
//! standalone sizes. Keep exploratory screens out of final process medians.
use serde_json::Value;
use std::{collections::BTreeMap, fmt::Write as _, fs, path::Path};
const DIR: &str = "generated/compact";
fn load(name: &str) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(serde_json::from_slice(&fs::read(
        Path::new(DIR).join(name),
    )?)?)
}
fn arr(v: &Value) -> &[Value] {
    v.as_array().unwrap()
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn n(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap()
}
fn med(mut a: Vec<f64>) -> f64 {
    a.sort_by(f64::total_cmp);
    (a[(a.len() - 1) / 2] + a[a.len() / 2]) / 2.
}
fn timing<'a>(r: &'a Value, name: &str, ds: &str) -> &'a Value {
    arr(&r["summary"])
        .iter()
        .find(|r| r["name"] == name && r["dataset"] == ds)
        .unwrap()
}
fn cold(c: &Value, name: &str, ds: &str, browser: &str) -> (f64, f64, f64) {
    let a: Vec<_> = arr(&c["rows"])
        .iter()
        .filter(|r| r["name"] == name && r["dataset"] == ds && s(r, "browser").starts_with(browser))
        .map(|r| n(r, "readyMs"))
        .collect();
    (
        med(a.clone()),
        a.iter().copied().reduce(f64::min).unwrap(),
        a.iter().copied().reduce(f64::max).unwrap(),
    )
}
pub fn write() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = load("manifest.json")?;
    let builds = load("builds.json")?;
    let docs = load("documents.json")?;
    let checks = load("checks.json")?;
    let c = load("cold.json")?;
    let files = [
        "main-156.json",
        "main-109.json",
        "policy-156.json",
        "policy-109.json",
        "core-156.json",
        "core-109.json",
    ];
    let reports: Vec<_> = files.iter().map(|f| load(f)).collect::<Result<_, _>>()?;
    assert_eq!(checks["pass"], true);
    assert_eq!(c["pass"], true);
    for r in &reports {
        assert_eq!(r["pass"], true);
        assert_eq!(r["manifestSha256"], reports[0]["manifestSha256"]);
        for m in arr(&r["modules"]) {
            let b = arr(&builds)
                .iter()
                .find(|b| b["module"] == m["module"])
                .unwrap();
            assert_eq!(checks["hashes"][s(b, "name")], m["sha256"]);
        }
    }
    let out = Path::new("benchmarks/experiments/compact/results");
    fs::create_dir_all(out)?;
    for f in files.into_iter().chain([
        "checks.json",
        "cli-checks.json",
        "cold.json",
        "builds.json",
        "screen.json",
    ]) {
        fs::write(out.join(f), serde_json::to_vec(&load(f)?)?)?;
    }
    fs::write(
        out.join("documents.json"),
        serde_json::to_vec_pretty(&docs)?,
    )?;
    let mut csv=String::from("campaign,browser,codec,dataset,input_bytes,verify,format,heavy,source_bytes,median_ms,process_min_ms,process_max_ms,runs,samples_per_run\n");
    for (i, r) in reports.iter().enumerate() {
        for row in arr(&r["summary"]) {
            let m = arr(&r["modules"])
                .iter()
                .find(|m| m["name"] == row["name"])
                .unwrap();
            let format = m
                .get("runtimeFormat")
                .unwrap_or_else(|| m["formats"].as_array().unwrap().last().unwrap());
            let heavy = m
                .get("runtimeHeavy")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            writeln!(
                csv,
                "{},{},{},{},{},{},{},{},{},{:.6},{:.6},{:.6},{},9",
                ["main", "main", "policy", "policy", "core", "core"][i],
                s(r, "browser"),
                s(row, "name"),
                s(row, "dataset"),
                row["bytes"],
                ["none", "fast", "secure"][row["kind"].as_u64().unwrap() as usize],
                format,
                heavy,
                row["sourceBytes"],
                n(row, "ms"),
                n(row, "runMin"),
                n(row, "runMax"),
                row["runs"]
            )?;
        }
    }
    fs::write(out.join("timings.csv"), csv)?;
    let mut cold_csv = String::from(
        "browser,codec_container,dataset,round,input_bytes,html_bytes,ready_ms,first_call_ms\n",
    );
    for r in arr(&c["rows"]) {
        writeln!(
            cold_csv,
            "{},{},{},{},{},{},{:.4},{:.4}",
            s(r, "browser"),
            s(r, "name"),
            s(r, "dataset"),
            r["round"],
            r["bytes"],
            r["htmlBytes"],
            n(r, "readyMs"),
            n(r, "callMs")
        )?;
    }
    fs::write(out.join("cold.csv"), cold_csv)?;
    let mut source_csv = String::from(
        "dataset,input_bytes,verify,packet,mask,raw_source_bytes,template_source_bytes\n",
    );
    for r in arr(&manifest["rows"]) {
        for (name, p) in r["packets"].as_object().unwrap() {
            writeln!(
                source_csv,
                "{},{},{},{},{},{},{}",
                s(r, "dataset"),
                r["bytes"],
                ["none", "fast", "secure"][r["kind"].as_u64().unwrap() as usize],
                name,
                p["mask"],
                p["sourceBytes"],
                p["templateSourceBytes"]
            )?;
        }
    }
    fs::write(out.join("source-sizes.csv"), source_csv)?;
    // The complete HTML framing contains no size/name-dependent constants.
    // Actual documents prove its byte overhead is invariant across all sizes.
    let mut overhead: BTreeMap<(String, String), u64> = BTreeMap::new();
    for d in arr(&docs) {
        let key = (s(d, "codec").to_string(), s(d, "container").to_string());
        let k = d["htmlBytes"].as_u64().unwrap() - d["sourceBytes"].as_u64().unwrap();
        if let Some(old) = overhead.insert(key, k) {
            assert_eq!(old, k)
        }
    }
    let selected = [
        "pair-control",
        "ans1",
        "ans4",
        "ans8",
        "both-pair",
        "both-ans4",
    ];
    let mut size_csv=String::from("dataset,input_bytes,codec,container,chosen_packet,source_bytes,html_bytes,bytes_saved_vs_pair_control\n");
    let mut totals: BTreeMap<(String, String, String), (u64, String)> = BTreeMap::new();
    for r in arr(&manifest["rows"]).iter().filter(|r| r["kind"] == 2) {
        for container in ["raw", "template"] {
            let field = if container == "raw" {
                "sourceBytes"
            } else {
                "templateSourceBytes"
            };
            let baseline = r["packets"]["pair"][field].as_u64().unwrap()
                + overhead[&("pair-control".into(), container.into())];
            for name in selected.into_iter().chain(["both-auto"]) {
                let chosen = match name {
                    "pair-control" | "both-pair" => "pair",
                    "both-auto" => {
                        if n(&r["packets"]["pair"], field) <= n(&r["packets"]["ans4"], field) {
                            "pair"
                        } else {
                            "ans4"
                        }
                    }
                    "both-ans4" => "ans4",
                    other => other,
                };
                let module = if name == "both-auto" {
                    "both-ans4"
                } else {
                    name
                };
                let body = r["packets"][chosen][field].as_u64().unwrap();
                let total = body + overhead[&(module.into(), container.into())];
                writeln!(
                    size_csv,
                    "{},{},{},{},{},{},{},{}",
                    s(r, "dataset"),
                    r["bytes"],
                    name,
                    container,
                    chosen,
                    body,
                    total,
                    baseline as i64 - total as i64
                )?;
                totals.insert(
                    (s(r, "dataset").into(), name.into(), container.into()),
                    (total, chosen.into()),
                );
            }
        }
    }
    fs::write(out.join("standalone-sizes.csv"), size_csv)?;
    let mut decision=String::from("dataset,input_bytes,codec,raw_html_bytes,bytes_saved_vs_pair,warm_156_ms,warm_109_ms,raw_ready_156_ms,raw_ready_109_ms,template_ready_156_ms,template_ready_109_ms\n");
    let mut md=String::from("# Matched UTF-16 packing and optional-builder experiment\n\nAll packings use the **same 63,385-symbol production alphabet, same selected XOR mask, same message/trailer, same production allocator, same hash sources and same JS/Wasm adapter**. Only the transport changes. Pair control is compiled from unmodified production kernel sources. Production artifacts remain unchanged.\n\n[Small decision CSV](decision.csv) · [All decode timings](timings.csv) · [Complete-file sizes](standalone-sizes.csv) · [Raw cold samples](cold.csv)\n\n## Secure 10 MiB random input\n\nComplete raw-script HTML includes the actual decoder, gzip/base64 loader and UTF-16LE BOM. Warm measurements include fresh returned buffers and BLAKE3. Cold ready includes actual offline file parsing, module initialization and the first verified decode. Values are milliseconds.\n\n| Profile | HTML bytes | Saved vs pair | Warm 156 | Warm 109 | Raw ready 156 | Raw ready 109 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n");
    for ds in [
        "random-1KiB",
        "random-1MiB",
        "random-10MiB",
        "json-logs",
        "gzip-logs",
        "zeros-1MiB",
    ] {
        let r = arr(&manifest["rows"])
            .iter()
            .find(|r| r["dataset"] == ds && r["kind"] == 2)
            .unwrap();
        let baseline = totals[&(ds.into(), "pair-control".into(), "raw".into())].0;
        for name in selected {
            let total = totals[&(ds.into(), name.into(), "raw".into())].0;
            let a = timing(&reports[0], name, ds);
            let b = timing(&reports[1], name, ds);
            // Cold figures exist only for the three timed random sizes. Other
            // rows retain exact file size and warm speed without invented data.
            let cold_values = if ds.starts_with("random-") {
                let cr = cold(&c, &format!("{name}-raw"), ds, "156.").0;
                let old = cold(&c, &format!("{name}-raw"), ds, "109.").0;
                let ct = cold(&c, &format!("{name}-template"), ds, "156.").0;
                let ot = cold(&c, &format!("{name}-template"), ds, "109.").0;
                format!("{cr:.4},{old:.4},{ct:.4},{ot:.4}")
            } else {
                ",,,".into()
            };
            writeln!(
                decision,
                "{ds},{},{name},{total},{},{:.6},{:.6},{cold_values}",
                r["bytes"],
                baseline as i64 - total as i64,
                n(a, "ms"),
                n(b, "ms")
            )?;
            if ds == "random-10MiB" {
                let cr = cold(&c, &format!("{name}-raw"), ds, "156.").0;
                let old = cold(&c, &format!("{name}-raw"), ds, "109.").0;
                writeln!(
                    md,
                    "| {name} | {total} | {} B | {:.2} | {:.2} | {cr:.1} | {old:.1} |",
                    baseline as i64 - total as i64,
                    n(a, "ms"),
                    n(b, "ms")
                )?;
            }
        }
    }
    let compact = decision
        .lines()
        .filter(|line| line.starts_with("dataset,") || line.starts_with("random-10MiB,"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    fs::write(out.join("compact.csv"), compact)?;
    fs::write(out.join("decision.csv"), decision)?;
    md.push_str("\n## Hold the HTML container constant\n\nThree fresh browsers/profiles per point. Brackets show the observed range, not confidence intervals.\n\n| Profile | Container | 156 ready median [min,max] | 109 ready median [min,max] |\n| --- | --- | ---: | ---: |\n");
    for name in selected {
        for container in ["raw", "template"] {
            let a = cold(&c, &format!("{name}-{container}"), "random-10MiB", "156.");
            let b = cold(&c, &format!("{name}-{container}"), "random-10MiB", "109.");
            writeln!(
                md,
                "| {name} | {container} | {:.1} [{:.1}, {:.1}] | {:.1} [{:.1}, {:.1}] |",
                a.0, a.1, a.2, b.0, b.1, b.2
            )?;
        }
    }
    md.push_str("\n## Payload-specific size tradeoff\n\nActual secure raw-script file bytes saved against the dedicated production pair decoder; negative values mean a larger file. `both-auto` is a size simulation choosing the smaller available body for the combined decoder, not an exported automatic encoder policy.\n\n| Dataset | ANS smallest (1 state) | ANS balanced (4 states) | Combined, choose smaller body |\n| --- | ---: | ---: | ---: |\n");
    for ds in [
        "random-1KiB",
        "random-64KiB",
        "random-1MiB",
        "random-2097152B",
        "random-4194304B",
        "random-10MiB",
        "json-logs",
        "gzip-logs",
        "zeros-1MiB",
        "utf8-text",
        "decoder-wasm",
    ] {
        let base = totals[&(ds.into(), "pair-control".into(), "raw".into())].0;
        write!(md, "| {ds} |")?;
        for name in ["ans1", "ans4", "both-auto"] {
            write!(
                md,
                " {} B |",
                base as i64 - totals[&(ds.into(), name.into(), "raw".into())].0 as i64
            )?;
        }
        md.push('\n');
    }
    md.push_str("\n## Decoder cost\n\nActual independent ESM bytes; the Wasm column includes no loader. Public adapters are assembled with the real builder. Secure, full and unchecked/core policies are separate specializations.\n\n| Build | ESM bytes | Wasm bytes | Gzip Wasm bytes |\n| --- | ---: | ---: | ---: |\n");
    for b in arr(&builds).iter().filter(|b| b["name"] != "all") {
        writeln!(
            md,
            "| {} | {} | {} | {} |",
            s(b, "name"),
            b["moduleBytes"],
            b["wasmBytes"],
            b["wasmGzipBytes"]
        )?;
    }
    md.push_str("\n## All 12 runtime policies on Chromium 156\n\nMatched full kernels, random 1 MiB, milliseconds. Heavy-table allocation is warmed and excluded from these repeated calls. It applies to pair packing; ANS does not need that table. Chrome 109 and other inputs are in the timing CSV.\n\n| Verification | Format | Heavy | Pair | ANS4 | Combined/pair | Combined/ANS4 |\n| --- | --- | --- | ---: | ---: | ---: | ---: |\n");
    for kind in 0..3u64 {
        for format in [false, true] {
            for heavy in [false, true] {
                write!(
                    md,
                    "| {} | {format} | {heavy} |",
                    ["none", "fast", "secure"][kind as usize]
                )?;
                for base in [
                    "pair-control-full",
                    "ans4-full",
                    "both-full-pair",
                    "both-full-ans4",
                ] {
                    let name = format!("{base}-f{}-h{}", u8::from(format), u8::from(heavy));
                    let row = arr(&reports[2]["summary"])
                        .iter()
                        .find(|r| {
                            r["name"] == name && r["dataset"] == "random-1MiB" && r["kind"] == kind
                        })
                        .unwrap();
                    write!(md, " {:.3} |", n(row, "ms"))?;
                }
                md.push('\n');
            }
        }
    }
    md.push('\n');
    md.push_str(include_str!("notes.md"));
    fs::write(out.join("RESULTS.md"), md)?;
    println!(
        "Wrote matched comparison: {} timed cases, {} cold loads",
        reports.iter().map(|r| arr(&r["rows"]).len()).sum::<usize>(),
        arr(&c["rows"]).len()
    );
    Ok(())
}
