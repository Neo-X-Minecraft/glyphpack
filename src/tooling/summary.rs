//! CSV parsing and the default report command for public benchmark data.
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
pub fn compact(root: &std::path::Path) -> Result<(), String> {
    super::report::write(
        &root.join("generated/results/encoding-decode-benchmark.csv"),
        &root.join("generated/results/report"),
    )
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
