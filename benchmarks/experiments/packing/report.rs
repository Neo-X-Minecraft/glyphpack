//! 0BSD, NeoX. Summarize measurements without mixing exploratory and final runs.
//! Raw samples stay available beside the small decision and timing CSVs.
use serde_json::Value;
use std::{fmt::Write as _, fs, path::Path};

const INPUT: &str = "generated/packing";
const OUTPUT: &str = "benchmarks/experiments/packing/results";
fn load(name: &str) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(serde_json::from_slice(&fs::read(
        Path::new(INPUT).join(name),
    )?)?)
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn n(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap()
}
fn rows(v: &Value) -> &[Value] {
    v.as_array().unwrap()
}
fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    (values[(values.len() - 1) / 2] + values[values.len() / 2]) / 2.
}
fn warm<'a>(report: &'a Value, name: &str, dataset: &str, kind: u64) -> &'a Value {
    rows(&report["summary"])
        .iter()
        .find(|r| s(r, "name") == name && s(r, "dataset") == dataset && r["kind"] == kind)
        .unwrap()
}
fn cold(c: &Value, name: &str, dataset: &str, browser: &str, field: &str) -> f64 {
    median(
        rows(&c["rows"])
            .iter()
            .filter(|r| {
                s(r, "name") == name
                    && s(r, "dataset") == dataset
                    && s(r, "browser").starts_with(browser)
            })
            .map(|r| n(r, field))
            .collect(),
    )
}
fn policy(kind: u64) -> &'static str {
    ["none", "fast", "secure"][kind as usize]
}
pub fn write() -> Result<(), Box<dyn std::error::Error>> {
    let a = load("final-156.json")?;
    let b = load("final-109.json")?;
    let c = load("cold.json")?;
    let docs = load("documents.json")?;
    let manifest = load("manifest.json")?;
    let checks = load("correctness.json")?;
    let protocol = load("protocol.json")?;
    for v in [&a, &b, &c, &checks, &protocol] {
        assert_eq!(v["pass"], true);
    }
    // A later rebuild must not accidentally be reported as the tested binary.
    assert_eq!(a["manifestSha256"], b["manifestSha256"]);
    for report in [&a, &b] {
        for module in rows(&report["modules"]) {
            assert_eq!(checks["hashes"][s(module, "name")], module["sha256"]);
        }
    }
    fs::create_dir_all(OUTPUT)?;
    let out = Path::new(OUTPUT);
    for name in [
        "final-156.json",
        "final-109.json",
        "cold.json",
        "correctness.json",
        "protocol.json",
        "screen.json",
        "wide-screen.json",
        "utf8-screen.json",
    ] {
        let v = load(name)?;
        fs::write(out.join(name), serde_json::to_vec(&v)?)?;
    }
    let mut timings=String::from("browser,codec,dataset,input_bytes,verify,source_bytes,median_ms,run_min_ms,run_max_ms,mib_s,runs,samples_per_run,batch_min,batch_max,wasm_retained_bytes\n");
    for report in [&a, &b] {
        for r in rows(&report["summary"]) {
            let samples: Vec<_> = rows(&report["rows"])
                .iter()
                .filter(|x| {
                    x["name"] == r["name"] && x["dataset"] == r["dataset"] && x["kind"] == r["kind"]
                })
                .collect();
            let batches: Vec<_> = samples
                .iter()
                .map(|x| x["batch"].as_u64().unwrap())
                .collect();
            let memory = samples
                .iter()
                .filter_map(|x| x["wasmRetainedBytes"].as_u64())
                .max()
                .map(|x| x.to_string())
                .unwrap_or_default();
            writeln!(
                timings,
                "{},{},{},{},{},{},{:.6},{:.6},{:.6},{:.3},{},9,{},{},{}",
                s(report, "browser"),
                s(r, "name"),
                s(r, "dataset"),
                r["bytes"],
                policy(r["kind"].as_u64().unwrap()),
                r["sourceBytes"],
                n(r, "ms"),
                n(r, "runMin"),
                n(r, "runMax"),
                n(r, "bytes") / 1048576. / (n(r, "ms") / 1000.),
                r["runs"],
                batches.iter().min().unwrap(),
                batches.iter().max().unwrap(),
                memory
            )?;
        }
    }
    fs::write(out.join("timings.csv"), timings)?;
    let mut sizes = String::from(
        "dataset,input_bytes,verify,packet,source_bytes,source_units,mask,overhead_pct\n",
    );
    for r in rows(&manifest["rows"]) {
        for (name, p) in r["packets"].as_object().unwrap() {
            let overhead = if n(r, "bytes") == 0. {
                String::new()
            } else {
                format!("{:.8}", (n(p, "sourceBytes") / n(r, "bytes") - 1.) * 100.)
            };
            let mask = p["mask"]
                .as_u64()
                .map(|x| x.to_string())
                .unwrap_or_default();
            writeln!(
                sizes,
                "{},{},{},{},{},{},{},{}",
                s(r, "dataset"),
                r["bytes"],
                policy(r["kind"].as_u64().unwrap()),
                name,
                p["sourceBytes"],
                p["units"],
                mask,
                overhead
            )?;
        }
    }
    fs::write(out.join("sizes.csv"), sizes)?;
    let mut cold_csv =
        String::from("browser,codec,dataset,round,input_bytes,html_bytes,ready_ms,first_call_ms\n");
    for r in rows(&c["rows"]) {
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
    let mut decision=String::from("codec,input_bytes,source_bytes,html_bytes,html_overhead_pct,gzip9_html_bytes,secure_156_ms,secure_109_ms,cold_156_ms,cold_109_ms\n");
    let mut md=String::from("# Local packing comparison\n\nProduction remains unchanged. These are alternative wire formats and specialized experimental decoder builds, not a migration. Every final timing compares complete calls with the same verification policy and fresh owned output.\n\n[Decision CSV](decision.csv) · [All final timings](timings.csv) · [All source sizes](sizes.csv) · [Cold runs](cold.csv)\n\n## 10 MiB random input, secure verification\n\nSource includes framing, BLAKE3 and contextual escapes. HTML includes the actual inlined decoder, native gzip/base64 loader, escaping helper, charset declaration and BOM where appropriate. Warm times are medians of three independent process medians, in milliseconds.\n\n| Codec | Source bytes | Complete HTML bytes | HTML overhead | Warm 156 | Warm 109 | Cold ready 156 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n");
    for d in rows(&docs)
        .iter()
        .filter(|d| s(d, "dataset") == "random-10MiB")
    {
        let name = s(d, "name");
        let wa = warm(&a, name, "random-10MiB", 2);
        let wb = warm(&b, name, "random-10MiB", 2);
        let ca = cold(&c, name, "random-10MiB", "156.", "readyMs");
        let cb = cold(&c, name, "random-10MiB", "109.", "readyMs");
        let overhead = (n(d, "htmlBytes") / n(d, "bytes") - 1.) * 100.;
        writeln!(
            decision,
            "{name},{},{},{},{:.6},{},{:.6},{:.6},{:.4},{:.4}",
            d["bytes"],
            d["sourceBytes"],
            d["htmlBytes"],
            overhead,
            d["gzip9HtmlBytes"],
            n(wa, "ms"),
            n(wb, "ms"),
            ca,
            cb
        )?;
        writeln!(
            md,
            "| {name} | {} | {} | {overhead:.4}% | {:.2} | {:.2} | {ca:.1} |",
            d["sourceBytes"],
            d["htmlBytes"],
            n(wa, "ms"),
            n(wb, "ms")
        )?;
    }
    fs::write(out.join("decision.csv"), decision)?;
    md.push_str("\n## Matched 1 MiB random input on Chromium 156\n\n| Codec | None (ms) | xxHash32 (ms) | BLAKE3 (ms) |\n| --- | ---: | ---: | ---: |\n");
    for d in rows(&docs)
        .iter()
        .filter(|d| s(d, "dataset") == "random-1MiB")
    {
        let name = s(d, "name");
        writeln!(
            md,
            "| {name} | {:.3} | {:.3} | {:.3} |",
            n(warm(&a, name, "random-1MiB", 0), "ms"),
            n(warm(&a, name, "random-1MiB", 1), "ms"),
            n(warm(&a, name, "random-1MiB", 2), "ms")
        )?;
    }
    md.push_str("\n## Cold file loads\n\nFresh browser/profile for each file; three runs per browser. Ready includes the actual file read, charset decoding, parsing, template restoration, gzip/base64 loading, Wasm instantiation and first verified decode. Browser launch and the independent SHA-256 comparison are excluded. The OS file cache may be warm. These descriptive ranges are not confidence intervals.\n\n| Codec | Input | 156 ready median [min, max] ms | 109 ready median [min, max] ms |\n| --- | --- | ---: | ---: |\n");
    for d in rows(&docs) {
        write!(md, "| {} | {} |", s(d, "name"), s(d, "dataset"))?;
        for browser in ["156.", "109."] {
            let x: Vec<_> = rows(&c["rows"])
                .iter()
                .filter(|r| {
                    r["name"] == d["name"]
                        && r["dataset"] == d["dataset"]
                        && s(r, "browser").starts_with(browser)
                })
                .map(|r| n(r, "readyMs"))
                .collect();
            let min = x.iter().copied().reduce(f64::min).unwrap();
            let max = x.iter().copied().reduce(f64::max).unwrap();
            write!(md, " {:.1} [{min:.1}, {max:.1}] |", median(x))?;
        }
        md.push('\n');
    }
    md.push('\n');
    md.push_str(include_str!("notes.md"));
    fs::write(out.join("RESULTS.md"), md)?;
    fs::write(
        out.join("documents.json"),
        serde_json::to_vec_pretty(&docs)?,
    )?;
    println!("Wrote final packing comparison and CSVs");
    Ok(())
}
