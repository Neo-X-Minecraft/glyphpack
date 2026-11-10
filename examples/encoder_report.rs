//! Aggregate independent encoder runs without combining architectures, feature
//! configurations or input fingerprints. Preserve raw JSON beside this report.
use serde_json::{json, Value};
use std::{collections::BTreeMap, env, fmt::Write as _, fs, path::Path};
fn median(v: &[f64]) -> f64 {
    let mut x = v.to_vec();
    x.sort_by(f64::total_cmp);
    (x[(x.len() - 1) / 2] + x[x.len() / 2]) / 2.
}
fn field(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or("").into()
}
fn xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('"', "&quot;")
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() < 2 {
        return Err("Usage: encoder_report output-directory report.json [...]".into());
    }
    let out = Path::new(&args[0]);
    fs::create_dir_all(out)?;
    let mut groups: BTreeMap<Vec<String>, Vec<[f64; 2]>> = BTreeMap::new();
    let mut contexts = BTreeMap::new();
    for file in &args[1..] {
        let r: Value = serde_json::from_slice(&fs::read(file)?)?;
        let kind = if r["kind"] == "browser" {
            "browser"
        } else if r["parallelFeature"] == true {
            "native-parallel"
        } else {
            "native"
        };
        let signature = json!({"architecture":r["architecture"],"rustc":r["rustc"],"rustflags":r["rustflags"],"browser":r["browser"],"modules":r["modules"],"host":r["host"],"sources":r["sourceFingerprints"]});
        if let Some(previous) = contexts.get(kind) {
            if previous != &signature {
                return Err(
                    format!("Cannot mix different source/environment contexts for {kind}").into(),
                );
            }
        } else {
            contexts.insert(kind.to_string(), signature);
        }
        for row in r["rows"].as_array().ok_or("Missing rows")? {
            // Individual empty native calls can fall below Instant's clock
            // resolution. Keep their original samples in the raw archive, but
            // omit every empty native case consistently from timing summaries.
            // Browser batches are calibrated and do not have this limitation.
            if kind != "browser" && row["bytes"] == 0 {
                continue;
            }
            let key = vec![
                kind.into(),
                field(row, "dataset"),
                row["bytes"].to_string(),
                field(row, "input_blake3"),
                field(row, "integrity"),
                field(row, "policy"),
                field(row, "backend"),
            ];
            let mut times = [0.; 2];
            for (i, time) in times.iter_mut().enumerate() {
                let samples: Vec<_> = row["samples"][i]
                    .as_array()
                    .ok_or("Missing samples")?
                    .iter()
                    .map(|v| v.as_f64().unwrap())
                    .collect();
                if samples.len() != 9 || samples.iter().any(|n| !n.is_finite() || *n <= 0.) {
                    return Err("Expected nine positive measured samples".into());
                }
                *time = median(&samples);
            }
            groups.entry(key).or_default().push(times);
        }
    }
    let mut all=String::from("kind,dataset,bytes,input_blake3,integrity,policy,backend,runs,before_ms,after_ms,speedup,before_run_min_ms,before_run_max_ms,after_run_min_ms,after_run_max_ms\n");
    let mut rows = Vec::new();
    for (key, runs) in groups {
        if key.iter().any(|s| s.contains([',', '\n', '"'])) {
            return Err("Unexpected CSV label".into());
        }
        let a: Vec<_> = runs.iter().map(|r| r[0]).collect();
        let b: Vec<_> = runs.iter().map(|r| r[1]).collect();
        let before = median(&a);
        let after = median(&b);
        writeln!(
            all,
            "{},{},{before:.9},{after:.9},{:.6},{:.9},{:.9},{:.9},{:.9}",
            key.join(","),
            runs.len(),
            before / after,
            a.iter().copied().fold(f64::INFINITY, f64::min),
            a.iter().copied().fold(0., f64::max),
            b.iter().copied().fold(f64::INFINITY, f64::min),
            b.iter().copied().fold(0., f64::max)
        )?;
        rows.push(json!({"kind":key[0],"dataset":key[1],"bytes":key[2],"integrity":key[4],"policy":key[5],"backend":key[6],"runs":runs.len(),"before_ms":before,"after_ms":after,"speedup":before/after}));
    }
    fs::write(out.join("all-settings.csv"), all)?;
    fs::write(
        out.join("environment.json"),
        serde_json::to_string_pretty(&contexts)? + "\n",
    )?;
    let selected: Vec<_> = rows
        .iter()
        .filter(|r| {
            r["integrity"] == "secure"
                && ((r["kind"] == "browser"
                    && ((r["dataset"] == "random-1MiB" || r["dataset"] == "gzip-logs")
                        && (r["policy"] == "sampled" || r["policy"] == "exact")))
                    || (r["kind"] == "native"
                        && r["dataset"] == "random-1MiB"
                        && r["backend"] == "utf16le"
                        && (r["policy"] == "fixed0" || r["policy"] == "exact"))
                    || (r["kind"] == "native-parallel"
                        && r["dataset"] == "random-1MiB"
                        && r["backend"] == "utf16le"
                        && r["policy"] == "exact"))
        })
        .collect();
    let mut compact = String::from("kind,dataset,policy,before_ms,after_ms,speedup\n");
    let mut md=String::from("# Encoder comparison\n\nComplete paired calls with BLAKE3. Unpinned hosts; lower milliseconds is faster. Native outputs are fresh buffers; browser output capacity is warm. See the adjacent environment and raw samples for each campaign.\n\n| Runtime | Input | Policy | Before ms | After ms | Speedup |\n| --- | --- | --- | ---: | ---: | ---: |\n");
    let height = 105 + selected.len() * 64;
    let mut svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"980\" height=\"{height}\" viewBox=\"0 0 980 {height}\" role=\"img\" aria-label=\"Encoder before and after timings, each pair normalized to its baseline\"><rect width=\"100%\" height=\"100%\" fill=\"#101318\"/><g fill=\"#edf1f7\" font-family=\"system-ui,sans-serif\"><text x=\"24\" y=\"30\" font-size=\"20\">Encoder · BLAKE3 · complete calls</text><text x=\"24\" y=\"53\" font-size=\"13\">Each pair has its own baseline scale · lower is faster · unpinned host</text><text x=\"24\" y=\"76\" font-size=\"13\">Gray: frozen reference · green: current implementation</text>");
    for (i, r) in selected.iter().enumerate() {
        let k = field(r, "kind");
        let d = field(r, "dataset");
        let p = field(r, "policy");
        let a = r["before_ms"].as_f64().unwrap();
        let b = r["after_ms"].as_f64().unwrap();
        writeln!(compact, "{k},{d},{p},{a:.6},{b:.6},{:.4}", a / b)?;
        writeln!(md, "| {k} | {d} | {p} | {a:.4} | {b:.4} | {:.2}× |", a / b)?;
        let y = 99 + i * 64;
        writeln!(svg,"<text x=\"24\" y=\"{}\" font-size=\"12\">{}</text><text x=\"24\" y=\"{}\" font-size=\"12\">{}</text><rect x=\"310\" y=\"{y}\" width=\"390\" height=\"17\" fill=\"#8292a5\"/><rect x=\"310\" y=\"{}\" width=\"{:.2}\" height=\"17\" fill=\"#5cdbb1\"/><text x=\"730\" y=\"{}\" font-size=\"12\">{a:.3} → {b:.3} ms · {:.2}×</text>",y+14,xml(&format!("{k} / {p}")),y+34,xml(&d),y+22,390.*b/a,y+29,a/b)?;
    }
    svg.push_str("</g></svg>\n");
    fs::write(out.join("compact.csv"), compact)?;
    fs::write(out.join("summary.md"), md)?;
    fs::write(out.join("encode.svg"), svg)?;
    println!("Reported {} settings", rows.len());
    Ok(())
}
