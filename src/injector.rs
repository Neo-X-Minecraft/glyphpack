//! Codec-independent HTML injection. Payload text is never HTML-escaped:
//! script raw-text blocks preserve entities literally. Reject '<' instead.
use std::collections::BTreeMap;

fn escape(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '\'' => "&#x27;".into(),
            _ => c.to_string(),
        })
        .collect()
}
fn valid_attribute(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == ':')
        && chars.all(|c| c.is_ascii_alphanumeric() || "_:.-".contains(c))
}

/// Create an inert script data block. Extra attributes may override id/type;
/// names are validated and values escaped, while payload characters stay exact.
pub fn payload_element(
    id: &str,
    text: &str,
    attributes: &BTreeMap<String, String>,
) -> Result<String, String> {
    if text.contains('<') {
        return Err("Encoded script payload must exclude '<'".into());
    }
    let mut attrs = BTreeMap::from([
        ("id".into(), id.into()),
        ("type".into(), "application/octet-stream".into()),
    ]);
    attrs.extend(attributes.clone());
    let mut html = "<script".to_string();
    for (name, value) in attrs {
        if !valid_attribute(&name) {
            return Err("Invalid HTML attribute name".into());
        }
        html.push_str(&format!(" {name}=\"{}\"", escape(&value)));
    }
    html.push('>');
    html.push_str(text);
    html.push_str("</script>");
    Ok(html)
}

/// Replace literal markers in a single pass over the original template.
/// Insertions cannot recursively trigger replacements; longest marker wins when
/// markers share a prefix. Marker names and replacement contents are arbitrary.
pub fn inject_html(
    template: &str,
    replacements: &BTreeMap<String, String>,
) -> Result<String, String> {
    if replacements.keys().any(|key| key.is_empty()) {
        return Err("Replacement markers must be nonempty".into());
    }
    let mut markers: Vec<_> = replacements.iter().collect();
    markers.sort_by_key(|(key, _)| std::cmp::Reverse(key.len()));
    let mut out = String::with_capacity(template.len());
    let mut at = 0;
    while at < template.len() {
        if let Some((key, value)) = markers
            .iter()
            .find(|(key, _)| template[at..].starts_with(key.as_str()))
        {
            out.push_str(value);
            at += key.len();
        } else {
            let c = template[at..].chars().next().unwrap();
            out.push(c);
            at += c.len_utf8();
        }
    }
    Ok(out)
}

/// Serialize a whole HTML document as UTF-16LE with its browser-recognized BOM.
/// Encoding payloads alone deliberately does not insert this document-level BOM.
pub fn utf16_document(html: &str) -> Vec<u8> {
    [0xfeff]
        .into_iter()
        .chain(html.encode_utf16())
        .flat_map(u16::to_le_bytes)
        .collect()
}
