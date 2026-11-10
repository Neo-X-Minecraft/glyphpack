//! Convert the historical recheck's browser observations to plain CSV and a
//! compact decision table. Raw batches and old measurements stay separate.
use super::fixtures::hex;
use crate::hash::blake3;
use serde_json::{json, Value};
use std::{collections::BTreeMap, fmt::Write as _, fs, path::Path};
fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").into()
}
fn csv(value: &str) -> String {
    if value.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.into()
    }
}
fn line(out: &mut String, fields: &[String]) {
    out.push_str(&fields.iter().map(|s| csv(s)).collect::<Vec<_>>().join(","));
    out.push('\n');
}
fn median(values: &[f64]) -> f64 {
    let mut values = values.to_vec();
    values.sort_by(f64::total_cmp);
    (values[(values.len() - 1) / 2] + values[values.len() / 2]) / 2.0
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
#[derive(Clone)]
struct Cell {
    stage: String,
    id: String,
    family: String,
    dataset: String,
    bytes: u64,
    format: String,
    mode: String,
    memory: String,
    mask: String,
    stored: String,
    runs: BTreeMap<u64, f64>,
    batches: usize,
}
impl Cell {
    fn center(&self) -> f64 {
        median(&self.runs.values().copied().collect::<Vec<_>>())
    }
}
fn load(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn write(root: &Path) -> Result<(), String> {
    let out = root.join("generated/results/history");
    let native = load(&root.join("generated/history/manifest.json"))?;
    let campaign = load(&out.join("manifest-current.json"))?;
    let expected_campaign = campaign["campaignSha256"]
        .as_str()
        .ok_or("Missing campaign fingerprint")?;
    let mut raw=String::from("stage,run,dataset,bytes,family,implementation,integrity,format_option,memory_heavy,mask_policy,stored_integrity,input_schema,phase,sample_index,execution_order,batch,total_ms,ms_per_call,MB_per_s,input_sha256\n");
    let mut cells: BTreeMap<Vec<String>, Cell> = BTreeMap::new();
    let mut phases = Vec::new();
    for stage in [
        "screen",
        "confirmation",
        "small-stores",
        "profiles",
        "hashes",
        "masks",
    ] {
        let path = out.join(format!("{stage}.json"));
        let report = load(&path)?;
        if report["campaignSha256"] != expected_campaign {
            return Err(format!("Mismatched campaign: {stage}; rerun this phase"));
        }
        if report["pass"] != true {
            return Err(format!("Incomplete phase: {stage}"));
        }
        let rows = report["rows"]
            .as_array()
            .ok_or("Missing observation rows")?;
        phases.push(json!({"phase":stage,"rows":rows.len()}));
        for row in rows {
            let options = &row["options"];
            let id = text(row, "id");
            let family = if row["family"].is_string() {
                text(row, "family")
            } else {
                "hash".into()
            };
            let dataset = text(row, "dataset");
            let bytes = row["bytes"].as_u64().ok_or("Missing byte count")?;
            let schema = if row["packetKind"] == "legacy" {
                "legacy"
            } else if stage == "hashes" {
                "raw-bytes"
            } else {
                "format-3"
            };
            let format = if schema == "legacy" || !options["verifyFormat"].is_boolean() {
                String::new()
            } else {
                options["verifyFormat"].to_string()
            };
            let mode = options["verifyData"].as_str().unwrap_or("").to_string();
            let memory = if options["memoryHeavy"].is_boolean() {
                options["memoryHeavy"].to_string()
            } else {
                String::new()
            };
            let mask = text(row, "maskPolicy");
            let stored = row["packetMode"].as_str().unwrap_or(&mode).to_string();
            let run = row["run"].as_u64().ok_or("Missing browser run")?;
            let mut samples = Vec::new();
            let times = row["times"].as_array().ok_or("Missing timing samples")?;
            let first = row["firstForInputMs"]
                .as_f64()
                .map(|ms| json!({"phase":"first_for_input","round":0,"ms":ms}));
            for t in first.iter().chain(times.iter()) {
                let ms = t["ms"].as_f64().ok_or("Invalid timing")?;
                if !ms.is_finite() || ms < 0.0 {
                    return Err("Non-finite or negative timing".into());
                }
                if t["phase"] == "measured" {
                    samples.push(ms);
                }
                let batch = if t["phase"] == "first_for_input" {
                    1
                } else {
                    row["batch"].as_u64().ok_or("Missing batch size")?
                };
                line(
                    &mut raw,
                    &[
                        stage.into(),
                        run.to_string(),
                        dataset.clone(),
                        bytes.to_string(),
                        family.clone(),
                        id.clone(),
                        mode.clone(),
                        format.clone(),
                        memory.clone(),
                        mask.clone(),
                        stored.clone(),
                        schema.into(),
                        text(t, "phase"),
                        t["round"].to_string(),
                        t["order"]
                            .as_u64()
                            .map(|n| n.to_string())
                            .unwrap_or_default(),
                        batch.to_string(),
                        format!("{:.9}", ms * batch as f64),
                        format!("{ms:.9}"),
                        if ms > 0.0 {
                            format!("{:.3}", bytes as f64 / 1000.0 / ms)
                        } else {
                            String::new()
                        },
                        text(row, "inputSha256"),
                    ],
                );
            }
            if samples.is_empty() {
                return Err("No measured batches".into());
            }
            let key = vec![
                stage.into(),
                id.clone(),
                dataset.clone(),
                mask.clone(),
                stored.clone(),
            ];
            let entry = cells.entry(key).or_insert_with(|| Cell {
                stage: stage.into(),
                id,
                family,
                dataset,
                bytes,
                format,
                mode,
                memory,
                mask,
                stored,
                runs: BTreeMap::new(),
                batches: 0,
            });
            if entry.runs.insert(run, median(&samples)).is_some() {
                return Err("Duplicate run/configuration rows".into());
            }
            entry.batches += samples.len();
        }
    }
    let cells: Vec<_> = cells.into_values().collect();
    let mut summary=String::from("stage,dataset,bytes,family,implementation,integrity,format_option,memory_heavy,mask_policy,stored_integrity,runs,measured_batches,median_ms,min_run_ms,max_run_ms\n");
    for c in &cells {
        let medians: Vec<_> = c.runs.values().copied().collect();
        line(
            &mut summary,
            &[
                c.stage.clone(),
                c.dataset.clone(),
                c.bytes.to_string(),
                c.family.clone(),
                c.id.clone(),
                c.mode.clone(),
                c.format.clone(),
                c.memory.clone(),
                c.mask.clone(),
                c.stored.clone(),
                c.runs.len().to_string(),
                c.batches.to_string(),
                format!("{:.6}", c.center()),
                format!(
                    "{:.6}",
                    medians.iter().copied().fold(f64::INFINITY, f64::min)
                ),
                format!("{:.6}", medians.iter().copied().fold(0.0, f64::max)),
            ],
        );
    }
    fs::write(out.join("raw.csv"), raw).map_err(|e| e.to_string())?;
    fs::write(out.join("summary.csv"), summary).map_err(|e| e.to_string())?;
    let datasets: Vec<_> = native["inputs"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| {
            matches!(
                r["label"].as_str(),
                Some("random-65536" | "random-1048576" | "sequential-1048576")
            )
        })
        .map(|r| text(r, "label"))
        .collect();
    let mut compact=String::from("dataset,integrity,format_option,wasm_compact_ms,wasm_heavy_ms,frozen_js_compact_ms,best_archived_ms,best_archived_id,best_archived_ms_div_wasm_ms\n");
    super::report::write(&out.join("peers.csv"), &out.join("transport-report"))?;
    let mut markdown=String::from("# Local historical recheck\n\nAll listed times are new local measurements, in milliseconds per complete call.\nArchived sources and the released backend are measured within the same campaign.\nThe table reports median browser-run medians; it is not a cross-device guarantee.\nHistorical validation policies and table layouts differ; none of the archived code is promoted to production.\n\n");
    let mut svg=String::from("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"940\" height=\"680\" viewBox=\"0 0 940 680\"><rect width=\"940\" height=\"680\" fill=\"#101214\"/><g fill=\"#e7ebe8\" font-family=\"system-ui,sans-serif\"><text x=\"24\" y=\"32\" font-size=\"22\">Fresh local recheck · public fixtures</text><text x=\"24\" y=\"57\" font-size=\"12\">BLAKE3 + format checks · milliseconds · separate scale per dataset</text>");
    let mut y = 91;
    for dataset in &datasets {
        for (mode, format) in [("none", "false"), ("fast", "true"), ("secure", "true")] {
            let candidates: Vec<_> = cells
                .iter()
                .filter(|c| {
                    c.stage == "confirmation"
                        && c.dataset == *dataset
                        && c.mode == mode
                        && c.format == format
                        && c.mask == "adaptive"
                })
                .collect();
            let find = |family: &str, memory: &str| {
                candidates
                    .iter()
                    .find(|c| c.family == family && c.memory == memory)
                    .copied()
            };
            let Some(wasm) = find("wasm-release", "false") else {
                continue;
            };
            let heavy = find("wasm-release", "true");
            let js = find("js-reference", "false");
            let best = candidates
                .iter()
                .filter(|c| !matches!(c.family.as_str(), "wasm-release" | "js-reference"))
                .min_by(|a, b| a.center().total_cmp(&b.center()))
                .copied();
            line(
                &mut compact,
                &[
                    dataset.clone(),
                    mode.into(),
                    format.into(),
                    format!("{:.4}", wasm.center()),
                    heavy
                        .map(|c| format!("{:.4}", c.center()))
                        .unwrap_or_default(),
                    js.map(|c| format!("{:.4}", c.center())).unwrap_or_default(),
                    best.map(|c| format!("{:.4}", c.center()))
                        .unwrap_or_default(),
                    best.map(|c| c.id.clone()).unwrap_or_default(),
                    best.map(|c| format!("{:.3}", c.center() / wasm.center()))
                        .unwrap_or_default(),
                ],
            );
            if mode != "secure" {
                continue;
            }
            let _ = writeln!(
                markdown,
                "## {dataset} · {} bytes\n\n| Backend | Median ms |\n| --- | ---: |",
                wasm.bytes
            );
            let mut plotted = vec![
                ("Released Wasm · compact", wasm.center()),
                (
                    "Released Wasm · heavy",
                    heavy.map(Cell::center).unwrap_or(0.0),
                ),
                ("Frozen JS · compact", js.map(Cell::center).unwrap_or(0.0)),
                (
                    "Best measured archived path",
                    best.map(Cell::center).unwrap_or(0.0),
                ),
            ];
            plotted.retain(|(_, v)| *v > 0.0);
            let max = plotted.iter().map(|(_, v)| *v).fold(0.0, f64::max);
            let _ = write!(
                svg,
                "<text x=\"24\" y=\"{y}\" font-size=\"14\">{}</text>",
                xml(dataset)
            );
            y += 25;
            for (label, value) in plotted {
                let _ = writeln!(markdown, "| {label} | {value:.4} |");
                let _=write!(svg,"<text x=\"24\" y=\"{y}\" font-size=\"11\">{label}</text><rect x=\"232\" y=\"{}\" width=\"{:.2}\" height=\"14\" fill=\"{}\"/><text x=\"{:.2}\" y=\"{y}\" font-size=\"11\">{value:.3}</text>",y-11,value/max*580.0,if label.starts_with("Released"){"#cfe6c9"}else{"#73837a"},240.0+value/max*580.0);
                y += 24;
            }
            y += 25;
            markdown.push('\n');
        }
    }
    svg.push_str("<text x=\"24\" y=\"659\" font-size=\"11\">Warm instances; selected verification included; no fixed CPU clocks. Best archived path is a bounded selection.</text></g></svg>\n");
    markdown.push_str("`compact.csv` includes no-integrity and fast-check tiers as well. `summary.csv` retains every screened source/configuration and all datasets; `raw.csv` retains warm-up/measured batches. Blank option cells mean the option does not apply. Raw legacy validators have separate semantics. See the phase manifests for source/input fingerprints and exact coverage.\n");
    fs::write(out.join("compact.csv"), compact).map_err(|e| e.to_string())?;
    fs::write(out.join("summary.md"), markdown).map_err(|e| e.to_string())?;
    fs::write(out.join("comparison.svg"), svg).map_err(|e| e.to_string())?;
    let mut checks = Vec::new();
    if out.join("permutation.json").is_file() {
        let r = load(&out.join("permutation.json"))?;
        if r["campaignSha256"] != expected_campaign || r["pass"] != true {
            return Err("Incomplete permutation phase".into());
        }
        checks.push(json!({"phase":"permutation","pass":r["pass"],"runs":r["rows"].as_array().map(Vec::len)}));
    }
    if out.join("peers.json").is_file() {
        let r = load(&out.join("peers.json"))?;
        if r["campaignSha256"] != expected_campaign || r["pass"] != true {
            return Err("Incomplete peer phase".into());
        }
        let rows = r["runs"].as_array().ok_or("Missing peer runs")?;
        let datasets: std::collections::BTreeSet<_> =
            rows.iter().map(|r| text(r, "dataset")).collect();
        let runs: std::collections::BTreeSet<_> = rows.iter().map(|r| r["run"].as_u64()).collect();
        checks.push(json!({"phase":"peers","pass":r["pass"],"datasets":datasets.len(),"browserRuns":runs.len(),"datasetRunRows":rows.len(),"csvRows":r["csvRows"]}));
    }
    if checks.len() != 2 {
        return Err("Missing permutation or peer phase".into());
    }
    let sizes = load(&root.join("generated/history/sizes.json"))?;
    let patterns = load(&root.join("generated/history/patterns.json"))?;
    fs::write(
        out.join("patterns.json"),
        serde_json::to_vec_pretty(&patterns).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    fs::write(out.join("coverage.json"),serde_json::to_vec_pretty(&json!({"campaignSha256":expected_campaign,"quick":native["quick"],"phases":phases,"additional":checks,"selectedDatasets":datasets,"archivedSourceFiles":native["sources"].as_array().unwrap().len(),"summaryRows":cells.len(),"sizes":sizes,"releaseRuntimeChanged":false,"summaryBlake3":hex(&blake3(&fs::read(out.join("summary.csv")).unwrap()))})).unwrap()).map_err(|e|e.to_string())?;
    println!(
        "{} historical comparison rows: {}",
        cells.len(),
        out.display()
    );
    Ok(())
}
