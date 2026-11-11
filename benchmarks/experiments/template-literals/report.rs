//! Reproduce reports from the exact manifest checked by both browsers. Payload
//! source and fixture framing are separate; neither includes the test decoder.
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    fs,
    path::Path,
    process::Command,
};
fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap()
}
fn n(v: &Value, key: &str) -> u64 {
    v[key].as_u64().unwrap()
}
pub fn write() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new("generated/template-literals");
    let manifest: Value = serde_json::from_slice(&fs::read(root.join("manifest.json"))?)?;
    let browser: Value = serde_json::from_slice(&fs::read(root.join("browser-results.json"))?)?;
    if browser["pass"] != true {
        return Err("Both browsers must pass first".into());
    }
    let digest = Command::new("sha256sum")
        .arg(root.join("manifest.json"))
        .output()?;
    if !digest.status.success()
        || String::from_utf8_lossy(&digest.stdout)
            .split_whitespace()
            .next()
            != browser["manifestSha256"].as_str()
    {
        return Err("Parser checks refer to a different manifest".into());
    }
    let rows = manifest["rows"].as_array().unwrap();
    let baselines: BTreeMap<_, _> = rows
        .iter()
        .filter(|r| s(r, "profile") == "current-rawtext" && s(r, "policy") == "source-optimal")
        .map(|r| (s(r, "dataset"), n(r, "payloadBytes")))
        .collect();
    let out = Path::new("benchmarks/experiments/template-literals/results");
    fs::create_dir_all(out)?;
    let mut csv=String::from("dataset,input_bytes,encoding,profile,radix,policy,mask,payload_source_bytes,logical_source_utf8_bytes,extra_source_units,html_fixture_bytes,overhead_pct,bytes_saved_vs_current_full\n");
    let mut compact = String::from(
        "dataset,profile,input_bytes,payload_bytes,overhead_pct,bytes_saved_vs_current\n",
    );
    for r in rows {
        let dataset = s(r, "dataset");
        let bytes = n(r, "inputBytes");
        let payload = n(r, "payloadBytes");
        let overhead = if bytes == 0 {
            String::new()
        } else {
            format!("{:.8}", (payload as f64 / bytes as f64 - 1.) * 100.)
        };
        let saved = baselines[dataset] as i64 - payload as i64;
        writeln!(
            csv,
            "{dataset},{bytes},{},{},{},{},{},{payload},{},{},{},{overhead},{saved}",
            s(r, "encoding"),
            s(r, "profile"),
            n(r, "radix"),
            s(r, "policy"),
            n(r, "mask"),
            n(r, "payloadUtf8Bytes"),
            n(r, "extraUnits"),
            n(r, "htmlBytes")
        )?;
        if s(r, "policy") == "source-optimal"
            && matches!(dataset, "random-10MiB" | "gzip-logs" | "decoder-wasm")
            && matches!(
                s(r, "profile"),
                "current-rawtext"
                    | "wide-template"
                    | "wide-raw-tag"
                    | "wide-template-no-escapes"
                    | "all-utf16-escaped"
                    | "byte-template"
                    | "byte-raw-tag"
                    | "byte-rawtext"
                    | "byte-raw-tag-no-nul"
            )
        {
            writeln!(
                compact,
                "{dataset},{},{bytes},{payload},{overhead},{saved}",
                s(r, "profile")
            )?;
        }
    }
    fs::write(out.join("all-sizes.csv"), csv)?;
    fs::write(out.join("compact.csv"), compact)?;
    let mut md=String::from("# Template-literal vocabulary experiment\n\nLocal byte counts and real browser-parser checks. Both experiments use bytewise XOR and include a 32-byte BLAKE3 trailer for size parity. UTF-16 variants retain the production header and 31/32-bit pair construction; single-byte variants have a six-digit header and 15/16-bit pairs. These alternative alphabets are not wire-compatible with production format 3.\n\nMask selection checks all 256 values, skipping only proven nonwinning lower bounds or stopping at the theoretical minimum. It minimizes escaped source size. Original-alphabet packets are checked against the real production Rust encoder.\n\n");
    for encoding in ["utf-16le", "windows-1252"] {
        writeln!(md,"## Random 10 MiB / {encoding}\n\nPayload source bytes include escapes, headers, the digest and any tag sentinel. They exclude enclosing delimiters, HTML and decoder code. Fixture bytes include framing and the minified raw-tag helper, but exclude the common test decoder.\n\n| Profile | Alphabet | Source bytes | Overhead | Saved vs current | HTML fixture bytes |\n| --- | ---: | ---: | ---: | ---: | ---: |")?;
        for r in rows.iter().filter(|r| {
            s(r, "dataset") == "random-10MiB"
                && s(r, "policy") == "source-optimal"
                && s(r, "encoding") == encoding
        }) {
            let payload = n(r, "payloadBytes");
            let bytes = n(r, "inputBytes");
            writeln!(
                md,
                "| {} | {} | {payload} | {:.5}% | {} B | {} |",
                s(r, "profile"),
                n(r, "radix"),
                (payload as f64 / bytes as f64 - 1.) * 100.,
                baselines["random-10MiB"] as i64 - payload as i64,
                n(r, "htmlBytes")
            )?;
        }
        md.push('\n');
    }
    let checks = browser["rows"].as_array().unwrap();
    let versions: BTreeSet<_> = checks.iter().map(|r| s(r, "browser")).collect();
    let negative = checks.iter().filter(|r| r["negative"] == true).count();
    writeln!(md,"\n## Parser checks\n\n{} checks passed on {}. This includes {negative} deliberately broken controls that must fail. Positive cases preserve exact UTF-16 units or decoded stored bytes, keep the trailing HTML marker and script count, execute no injected expression, use the expected document charset, and make zero network requests under file://.\n",checks.len(),versions.into_iter().collect::<Vec<_>>().join(" and "))?;
    md.push_str(include_str!("notes.md"));
    fs::write(out.join("RESULTS.md"), md)?;
    fs::write(
        out.join("browser-checks.json"),
        serde_json::to_vec_pretty(&browser)?,
    )?;
    fs::write(
        out.join("profiles.json"),
        serde_json::to_vec_pretty(&manifest["profiles"])?,
    )?;
    println!(
        "Wrote {} size rows and {} parser checks",
        rows.len(),
        checks.len()
    );
    Ok(())
}
