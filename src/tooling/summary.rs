//! A 27-row sharing summary; the complete measured evidence remains untouched.
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

/// Standard quoted CSV parsing, including doubled quotes and embedded newlines.
/// Unicode bytes are preserved rather than interpreted as ASCII characters.
pub(crate) fn parse_csv(text: &str) -> Result<Vec<Vec<String>>, String> {
    let bytes = text.as_bytes();
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = Vec::new();
    let mut quoted = false;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'"' if quoted && bytes.get(i + 1) == Some(&b'"') => {
                field.push(b'"');
                i += 1;
            }
            b'"' => quoted = !quoted,
            b',' if !quoted => {
                row.push(String::from_utf8(std::mem::take(&mut field)).map_err(|e| e.to_string())?)
            }
            b'\n' if !quoted => {
                row.push(String::from_utf8(std::mem::take(&mut field)).map_err(|e| e.to_string())?);
                rows.push(std::mem::take(&mut row));
            }
            b'\r' if !quoted && bytes.get(i + 1) == Some(&b'\n') => {}
            _ => field.push(b),
        }
        i += 1;
    }
    if quoted {
        return Err("Unterminated CSV field".into());
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(String::from_utf8(field).map_err(|e| e.to_string())?);
        rows.push(row);
    }
    Ok(rows)
}
fn median(mut values: Vec<f64>) -> f64 {
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

pub fn compact(root: &Path) -> Result<(), String> {
    let source = root.join("benchmarks/results/encoding-decode-benchmark.csv");
    let rows = parse_csv(&fs::read_to_string(&source).map_err(|e| e.to_string())?)?;
    let fields = &rows[0];
    let column = |name: &str| {
        fields
            .iter()
            .position(|v| v == name)
            .ok_or_else(|| format!("Missing CSV column: {name}"))
    };
    let families = [
        "BMP16",
        "Base64",
        "Base64-atob",
        "Base122",
        "Base121",
        "Base85",
    ];
    let modes = ["none", "fast", "secure"];
    let selected = [
        ("random-64KiB", "random_65536B_ms"),
        ("random-1MiB", "random_1048576B_ms"),
        ("runtime", "runtime_ms"),
    ];
    let mut groups: BTreeMap<([String; 4], usize, usize), Vec<f64>> = BTreeMap::new();
    let mut configs = BTreeSet::new();
    let mut browser = String::new();
    for row in &rows[1..] {
        let get = |name: &str| -> Result<&str, String> {
            row.get(column(name)?)
                .map(String::as_str)
                .ok_or("Short CSV row".into())
        };
        if get("record_type")? != "sample"
            || get("phase")? != "measured"
            || get("stage")? != "comparison"
        {
            continue;
        }
        let Some(dataset) = selected
            .iter()
            .position(|(name, _)| *name == get("dataset").unwrap_or(""))
        else {
            continue;
        };
        if get("correct")? != "true" {
            return Err("Cannot summarize incorrect output".into());
        }
        let config = [
            get("family")?.into(),
            get("integrity_mode")?.into(),
            get("verify_format")?.into(),
            get("memory_heavy")?.into(),
        ];
        let run = get("run")?.parse().map_err(|_| "Invalid run")?;
        let time = get("decode_ms")?.parse().map_err(|_| "Invalid timing")?;
        browser = get("browser")?.into();
        configs.insert(config.clone());
        groups.entry((config, dataset, run)).or_default().push(time);
    }
    if configs.len() != 27 {
        return Err("Expected 27 comparison configurations".into());
    }
    let mut configs: Vec<_> = configs.into_iter().collect();
    configs.sort_by_key(|c| {
        (
            families.iter().position(|s| *s == c[0]).unwrap_or(99),
            modes.iter().position(|s| *s == c[1]).unwrap_or(99),
            c[2].clone(),
            c[3].clone(),
        )
    });
    let mut output = format!(
        "encoding,integrity,format_check,memory_heavy,{},{},{},notes\n",
        selected[0].1, selected[1].1, selected[2].1
    );
    for (index, config) in configs.iter().enumerate() {
        let mut fields = config.to_vec();
        for dataset in 0..3 {
            let mut medians = Vec::new();
            for run in 1..=3 {
                let samples = groups
                    .get(&(config.clone(), dataset, run))
                    .ok_or("Missing browser run")?;
                if samples.len() != 9 {
                    return Err("Expected nine measured batches per run".into());
                }
                medians.push(median(samples.clone()));
            }
            fields.push(format!("{:.4}", median(medians)));
        }
        fields.push(if index==0{format!("Chromium {browser}; ARM64. ms; lower is faster. Median of 3 browser-run medians; 9 measured batches/run; warm-ups excluded. Resident string to fresh bytes; checks included; encoding/I/O/parsing excluded. fast=XXH32; secure=unkeyed BLAKE3. BMP=full runtime build; memory table warm. Blank options=N/A; peer format checks differ. Base64=native setFromBase64; Base85=Ascii85; Base122/121/85=local optimized candidates; 121 is custom. 3 selected payloads; variability and other datasets omitted. Single unpinned ARM host. Full data: benchmarks/results/encoding-decode-benchmark.csv")}else{String::new()});
        output.push_str(&fields.iter().map(|v| csv(v)).collect::<Vec<_>>().join(","));
        output.push('\n');
    }
    let path = root.join("benchmarks/results/compact.csv");
    fs::write(&path, &output).map_err(|e| e.to_string())?;
    println!(
        "27 rows; 81 timings; {} bytes: {}",
        output.len(),
        path.display()
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quoted_csv() {
        assert_eq!(
            parse_csv("a,b\r\n\"λ,\"\"x\"\"\",\"line\n2\"\r\n").unwrap(),
            vec![vec!["a", "b"], vec!["λ,\"x\"", "line\n2"]]
        );
    }
}
