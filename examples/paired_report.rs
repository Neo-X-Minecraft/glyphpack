//! Compact, reproducible report for the browser's paired complete-call samples.
use serde_json::{json, Value};
use std::{env, fmt::Write as _, fs, path::Path};

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    (values[(values.len() - 1) / 2] + values[values.len() / 2]) / 2.0
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("Usage: paired_report input.json output-directory".into());
    }
    let report: Value = serde_json::from_slice(&fs::read(&args[0])?)?;
    let rows = report["rows"].as_array().ok_or("Missing rows")?;
    let summary = report["summary"].as_array().ok_or("Missing summary")?;
    let out = Path::new(&args[1]);
    fs::create_dir_all(out)?;
    let mut csv = "dataset,bytes,integrity,format,memory,before_ms,after_ms,speedup,before_run_min_ms,before_run_max_ms,after_run_min_ms,after_run_max_ms,runs,samples_per_run\n".to_string();
    let mut compact = "dataset,bytes,before_ms,after_ms,speedup\n".to_string();
    let defaults: Vec<_> = summary
        .iter()
        .filter(|r| r["integrity"] == "secure" && r["format"] == true && r["memory"] == false)
        .collect();
    for item in summary {
        let matching: Vec<_> = rows
            .iter()
            .filter(|r| {
                r["dataset"] == item["dataset"]
                    && r["verifyData"] == item["integrity"]
                    && r["verifyFormat"] == item["format"]
                    && r["memoryHeavy"] == item["memory"]
            })
            .collect();
        if matching.len() != 3 {
            return Err("Expected three fresh browser runs per setting".into());
        }
        let mut times = [Vec::new(), Vec::new()];
        for row in matching {
            for (index, medians) in times.iter_mut().enumerate() {
                let mut samples = row["samples"][index]
                    .as_array()
                    .ok_or("Missing samples")?
                    .iter()
                    .map(|v| v.as_f64().ok_or("Invalid sample"))
                    .collect::<Result<Vec<_>, _>>()?;
                if samples.len() != 9 || samples.iter().any(|v| !v.is_finite() || *v < 0.0) {
                    return Err("Expected nine finite measured samples per run".into());
                }
                medians.push(median(&mut samples));
            }
        }
        let before = median(&mut times[0]);
        let after = median(&mut times[1]);
        let name = item["dataset"].as_str().ok_or("Missing dataset")?;
        if name.contains([',', '\n', '"']) {
            return Err("Dataset label requires CSV escaping".into());
        }
        writeln!(
            csv,
            "{name},{},{},{},{},{before:.9},{after:.9},{:.6},{:.9},{:.9},{:.9},{:.9},3,9",
            item["bytes"],
            item["integrity"].as_str().unwrap(),
            item["format"],
            item["memory"],
            before / after,
            times[0][0],
            times[0][2],
            times[1][0],
            times[1][2]
        )?;
        if item["integrity"] == "secure" && item["format"] == true && item["memory"] == false {
            writeln!(
                compact,
                "{name},{},{before:.9},{after:.9},{:.6}",
                item["bytes"],
                before / after
            )?;
        }
    }
    fs::write(out.join("all-settings.csv"), csv)?;
    fs::write(out.join("compact.csv"), compact)?;
    let mut environment = report.clone();
    environment.as_object_mut().unwrap().remove("rows");
    environment.as_object_mut().unwrap().remove("summary");
    environment["observations"] =
        json!({"settings":summary.len(),"runs":rows.len(),"measuredBatchAverages":rows.len()*18});
    fs::write(
        out.join("environment.json"),
        serde_json::to_string_pretty(&environment)? + "\n",
    )?;
    // Normalize each pair to its baseline. Absolute milliseconds remain visible;
    // one very large input cannot make every smaller bar unreadable.
    let height = 120 + defaults.len() * 66;
    let mut svg = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"860\" height=\"{height}\" viewBox=\"0 0 860 {height}\" role=\"img\" aria-labelledby=\"title desc\"><title id=\"title\">GlyphPack secure decoding: v0.2.0 versus SIMD</title><desc id=\"desc\">Complete binary calls, format checks on and heavy lookup off. Each pair is normalized to its own baseline. Lower is faster.</desc><rect width=\"100%\" height=\"100%\" fill=\"#101318\"/><g font-family=\"system-ui,sans-serif\" fill=\"#edf1f7\"><text x=\"24\" y=\"30\" font-size=\"19\">Secure decoding · {} · {}</text><text x=\"24\" y=\"55\" font-size=\"13\">Complete warmed calls · median of 3 runs · lower is faster · baseline scaled to 100%</text><rect x=\"24\" y=\"72\" width=\"16\" height=\"10\" fill=\"#8292a5\"/><text x=\"48\" y=\"82\" font-size=\"13\">v0.2.0</text><rect x=\"150\" y=\"72\" width=\"16\" height=\"10\" fill=\"#5cdbb1\"/><text x=\"174\" y=\"82\" font-size=\"13\">v0.2.1 SIMD</text>", report["browser"].as_str().unwrap(), report["architecture"].as_str().unwrap());
    for (i, row) in defaults.iter().enumerate() {
        let y = 108 + i * 66;
        let name = row["dataset"]
            .as_str()
            .unwrap()
            .replace('&', "&amp;")
            .replace('<', "&lt;");
        let before = row["before_ms"].as_f64().unwrap();
        let after = row["after_ms"].as_f64().unwrap();
        writeln!(svg, "<text x=\"24\" y=\"{}\" font-size=\"13\">{name}</text><rect x=\"210\" y=\"{y}\" width=\"420\" height=\"17\" fill=\"#8292a5\"/><text x=\"640\" y=\"{}\" font-size=\"12\">{before:.4} ms</text><rect x=\"210\" y=\"{}\" width=\"{:.2}\" height=\"17\" fill=\"#5cdbb1\"/><text x=\"640\" y=\"{}\" font-size=\"12\">{after:.4} ms · {:.2}×</text>",y+15,y+13,y+23,420.0*after/before,y+36,before/after)?;
    }
    svg.push_str("</g></svg>\n");
    fs::write(out.join("decode.svg"), svg)?;
    println!("Reported {} settings in {}", summary.len(), out.display());
    Ok(())
}
