//! Summarize current browser measurements without rewriting historical results.
//! Group raw measured batches by run first: the reported center is a median of
//! browser-run medians, and the range describes run-to-run variation, not tails.
use super::summary::parse_csv;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Variant {
    family: String,
    integrity: String,
    format: String,
    memory: String,
    implementation: String,
}
#[derive(Debug)]
struct Cell {
    variant: Variant,
    dataset: String,
    bytes: usize,
    runs: Vec<f64>,
    batches: usize,
}
fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    (values[(values.len() - 1) / 2] + values[values.len() / 2]) / 2.0
}
fn csv(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.into()
    }
}
fn xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn cells(text: &str) -> Result<Vec<Cell>, String> {
    let rows = parse_csv(text)?;
    let header = rows.first().ok_or("Empty benchmark CSV")?;
    let columns: BTreeMap<_, _> = header
        .iter()
        .enumerate()
        .map(|(i, s)| (s.as_str(), i))
        .collect();
    let required = [
        "record_type",
        "stage",
        "phase",
        "correct",
        "family",
        "integrity_mode",
        "verify_format",
        "memory_heavy",
        "implementation",
        "dataset",
        "decoded_bytes",
        "run",
        "decode_ms",
    ];
    for name in required {
        if !columns.contains_key(name) {
            return Err(format!("Missing CSV column: {name}"));
        }
    }
    let mut groups: BTreeMap<(Variant, String, usize, usize), Vec<f64>> = BTreeMap::new();
    for row in &rows[1..] {
        let get = |name| {
            row.get(columns[name])
                .map(String::as_str)
                .ok_or_else(|| "Short CSV row".to_string())
        };
        if get("record_type")? != "sample"
            || get("stage")? != "comparison"
            || get("phase")? != "measured"
        {
            continue;
        }
        if get("correct")? != "true" {
            return Err("Cannot summarize incorrect output".into());
        }
        let time: f64 = get("decode_ms")?.parse().map_err(|_| "Invalid timing")?;
        if !time.is_finite() || time < 0.0 {
            return Err("Invalid timing".into());
        }
        let variant = Variant {
            family: get("family")?.into(),
            integrity: get("integrity_mode")?.into(),
            format: get("verify_format")?.into(),
            memory: get("memory_heavy")?.into(),
            implementation: get("implementation")?.into(),
        };
        let bytes = get("decoded_bytes")?
            .parse()
            .map_err(|_| "Invalid byte count")?;
        let run = get("run")?.parse().map_err(|_| "Invalid run")?;
        groups
            .entry((variant, get("dataset")?.into(), bytes, run))
            .or_default()
            .push(time);
    }
    let mut merged: BTreeMap<(Variant, String, usize), (Vec<f64>, usize)> = BTreeMap::new();
    for ((variant, dataset, bytes, _), mut samples) in groups {
        let entry = merged.entry((variant, dataset, bytes)).or_default();
        entry.1 += samples.len();
        entry.0.push(median(&mut samples));
    }
    if merged.is_empty() {
        return Err("No measured comparison samples".into());
    }
    Ok(merged
        .into_iter()
        .map(|((variant, dataset, bytes), (runs, batches))| Cell {
            variant,
            dataset,
            bytes,
            runs,
            batches,
        })
        .collect())
}

/// Produce a small wide CSV, a detailed summary, a Markdown table and a real SVG
/// chart. The full raw CSV remains the evidence; summaries never replace it.
pub fn write(input: &Path, out: &Path) -> Result<(), String> {
    let io = |e: std::io::Error| e.to_string();
    let mut cells = cells(&fs::read_to_string(input).map_err(io)?)?;
    fs::create_dir_all(out).map_err(io)?;
    let variants: BTreeSet<_> = cells.iter().map(|c| c.variant.clone()).collect();
    let datasets: BTreeSet<_> = cells.iter().map(|c| (c.dataset.clone(), c.bytes)).collect();
    let mut wide = String::from("encoding,integrity,format_check,memory_heavy");
    for (dataset, _) in &datasets {
        wide.push(',');
        wide.push_str(&csv(&format!("{dataset}_ms")));
    }
    wide.push('\n');
    let mut detailed=String::from("encoding,implementation,integrity,format_check,memory_heavy,dataset,bytes,runs,batches,median_ms,min_run_ms,max_run_ms,MB_per_s\n");
    for variant in &variants {
        wide.push_str(
            &[
                &variant.family,
                &variant.integrity,
                &variant.format,
                &variant.memory,
            ]
            .map(|s| csv(s))
            .join(","),
        );
        for (dataset, _) in &datasets {
            wide.push(',');
            if let Some(cell) = cells
                .iter_mut()
                .find(|c| c.variant == *variant && c.dataset == *dataset)
            {
                wide.push_str(&format!("{:.6}", median(&mut cell.runs)));
            }
        }
        wide.push('\n');
    }
    for cell in &mut cells {
        let center = median(&mut cell.runs);
        let first = cell.runs[0];
        let last = *cell.runs.last().unwrap();
        let v = &cell.variant;
        detailed.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{center:.6},{first:.6},{last:.6},{:.3}\n",
            csv(&v.family),
            csv(&v.implementation),
            v.integrity,
            v.format,
            v.memory,
            csv(&cell.dataset),
            cell.bytes,
            cell.runs.len(),
            cell.batches,
            if center > 0.0 {
                cell.bytes as f64 / 1000.0 / center
            } else {
                0.0
            }
        ));
    }
    let mut markdown=String::from("# Decode benchmark\n\nResident string → fresh bytes, including selected verification. Encoding, I/O, parsing and module initialization are excluded. Values are **milliseconds**, the median of per-browser-run medians. Compact lookup; format checks enabled for GlyphPack. Peer validation and verifier implementations differ.\n\n");
    let chosen: Vec<_> = cells
        .iter()
        .filter(|c| {
            c.dataset == "random-1MiB"
                && (c.variant.family != "GlyphPack-Wasm"
                    || (c.variant.format == "true" && c.variant.memory == "false"))
        })
        .collect();
    let mut svg=String::from("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"920\" height=\"800\" viewBox=\"0 0 920 800\"><rect width=\"920\" height=\"800\" fill=\"#101214\"/><g font-family=\"system-ui,sans-serif\" fill=\"#e7ebe8\"><text x=\"28\" y=\"36\" font-size=\"22\">Decode 1 MiB · lower is faster</text><text x=\"28\" y=\"61\" font-size=\"12\" fill=\"#a1aaa7\">Median of run medians · checks included · local machine measurements</text>");
    let mut y = 96;
    for (mode, title) in [
        ("none", "No integrity"),
        ("fast", "XXH32"),
        ("secure", "BLAKE3"),
    ] {
        let mut rows: Vec<_> = chosen
            .iter()
            .filter(|c| c.variant.integrity == mode)
            .collect();
        rows.sort_by(|a, b| a.runs[a.runs.len() / 2].total_cmp(&b.runs[b.runs.len() / 2]));
        if rows.is_empty() {
            continue;
        }
        let max = rows
            .iter()
            .map(|c| c.runs[c.runs.len() / 2])
            .fold(0.0, f64::max)
            .max(f64::EPSILON);
        svg.push_str(&format!(
            "<text x=\"28\" y=\"{y}\" font-size=\"15\">{title}</text>"
        ));
        y += 27;
        markdown.push_str(&format!("## {title} · random 1 MiB\n\n| Decoder | Median ms | Run range ms |\n| --- | ---: | ---: |\n"));
        for cell in rows {
            let center = cell.runs[cell.runs.len() / 2];
            let family = &cell.variant.family;
            let low = cell.runs[0];
            let high = cell.runs.last().unwrap();
            markdown.push_str(&format!(
                "| {family} | {center:.4} | {low:.4}–{high:.4} |\n"
            ));
            svg.push_str(&format!("<text x=\"28\" y=\"{y}\" font-size=\"12\">{}</text><rect x=\"175\" y=\"{}\" width=\"{:.2}\" height=\"16\" fill=\"{}\"/><text x=\"{:.2}\" y=\"{y}\" font-size=\"12\">{center:.3} ms</text>",xml(family),y-13,center/max*595.0,if family=="GlyphPack-Wasm"{"#cfe6c9"}else{"#73837a"},182.0+center/max*595.0));
            y += 26;
        }
        y += 30;
        markdown.push('\n');
    }
    svg.push_str("<text x=\"28\" y=\"775\" font-size=\"11\" fill=\"#a1aaa7\">Separate scale per panel. Base121 is a local extension. Single host; no cross-device speed claims.</text></g></svg>\n");
    markdown.push_str("All settings and datasets are in `compact.csv`; `summary.csv` includes run ranges and sample counts. Consult the raw CSV and environment JSON before making performance claims. Different machines and browsers can change the ranking.\n");
    for (name, data) in [
        ("compact.csv", wide),
        ("summary.csv", detailed),
        ("summary.md", markdown),
        ("decode.svg", svg),
    ] {
        fs::write(out.join(name), data).map_err(io)?;
    }
    println!(
        "{} configurations; {} datasets: {}",
        variants.len(),
        datasets.len(),
        out.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excludes_warmups_and_summaries_and_groups_by_run() {
        let header="record_type,stage,phase,correct,family,integrity_mode,verify_format,memory_heavy,implementation,dataset,decoded_bytes,run,decode_ms\n";
        let raw=format!("{header}sample,comparison,measured,true,GlyphPack-Wasm,none,true,false,full,random-1MiB,1048576,1,1\nsample,comparison,measured,true,GlyphPack-Wasm,none,true,false,full,random-1MiB,1048576,1,3\nsample,comparison,measured,true,GlyphPack-Wasm,none,true,false,full,random-1MiB,1048576,2,4\nsummary,comparison,measured,true,ignore,none,,,x,d,1,1,999\nsample,comparison,warmup,true,ignore,none,,,x,d,1,1,999\n");
        let data = cells(&raw).unwrap();
        assert_eq!(data.len(), 1);
        assert_eq!(data[0].runs, vec![2.0, 4.0]);
        assert_eq!(data[0].batches, 3);
        assert!(cells(&raw.replace(",1\n", ",NaN\n")).is_err());
        assert!(cells(&raw.replace("measured,true", "measured,false")).is_err());
    }
}
