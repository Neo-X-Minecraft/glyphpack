//! HTML insertion and document encodings. Ordinary codecs use raw script text;
//! fast UTF-8 uses reversible RCDATA escaping, compact UTF-8 carries its guards.
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
    let utf8 = text.starts_with(char::from_u32(u32::from(crate::packing::UTF8_TAG)).unwrap());
    let compact =
        text.starts_with(char::from_u32(u32::from(crate::packing::UTF8_COMPACT_TAG)).unwrap());
    if compact {
        let lower = text.to_ascii_lowercase();
        if lower.contains("</script") || lower.contains("<script") || lower.contains("<!--") {
            return Err("Compact payload has an unprotected HTML transition".into());
        }
    }
    if !utf8 && !compact && text.contains('<') {
        return Err("Encoded script payload must exclude '<'".into());
    }
    let mut attrs = BTreeMap::from([
        ("id".into(), id.into()),
        ("type".into(), "application/octet-stream".into()),
    ]);
    attrs.extend(attributes.clone());
    // UTF-8 permits '<'. RCDATA decodes entities back into exact textContent;
    // only '&' and a possible closing textarea prefix need escaping. Escaping
    // every '<' would unnecessarily increase encoded file size by about 2%.
    let mut html = if utf8 {
        attrs.insert("hidden".into(), "".into());
        "<textarea".to_string()
    } else {
        "<script".to_string()
    };
    for (name, value) in attrs {
        if !valid_attribute(&name) {
            return Err("Invalid HTML attribute name".into());
        }
        html.push_str(&format!(" {name}=\"{}\"", escape(&value)));
    }
    html.push('>');
    if utf8 {
        for (i, c) in text.char_indices() {
            if c == '&' {
                html.push_str("&amp;");
            } else if c == '<'
                && text.as_bytes()[i..]
                    .get(..10)
                    .is_some_and(|s| s.eq_ignore_ascii_case(b"</textarea"))
            {
                html.push_str("&lt;");
            } else {
                html.push(c);
            }
        }
        html.push_str("</textarea>");
    } else {
        html.push_str(text);
        html.push_str("</script>");
    }
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
/// UTF-8 BOM takes precedence over incorrectly declared HTTP charsets.
pub fn utf8_document(html: &str) -> Vec<u8> {
    [b"\xef\xbb\xbf".as_slice(), html.as_bytes()].concat()
}
/// Single-byte HTML source for Windows packing. Characters outside the charset
/// must be written as HTML entities or JS/CSS escapes by the template author.
/// NUL represents the logical U+FFFD digit after HTML script tokenization.
pub fn windows1252_document(html: &str) -> Result<Vec<u8>, String> {
    html.encode_utf16().map(|c|crate::packing::windows_source_byte(c).ok_or_else(||format!("Document character U+{c:04X} is not representable in Windows-1252; use entities or Unicode escapes"))).collect()
}
/// Decode a Windows payload source into the logical string consumed by binary.
pub fn windows1252_payload_text(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| char::from_u32(u32::from(crate::packing::windows_code_point(b))).unwrap())
        .collect()
}
