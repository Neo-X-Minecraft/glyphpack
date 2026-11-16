//! Native transport helpers for build output. The browser reverses gzip with
//! its built-in DecompressionStream and base64 with its built-in byte decoder.

pub fn base64(data: &[u8]) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for b in data.chunks(3) {
        let n = ((b[0] as u32) << 16)
            | ((b.get(1).copied().unwrap_or(0) as u32) << 8)
            | b.get(2).copied().unwrap_or(0) as u32;
        out.push(A[(n >> 18) as usize] as char);
        out.push(A[((n >> 12) & 63) as usize] as char);
        out.push(if b.len() > 1 {
            A[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if b.len() > 2 {
            A[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Optimize static build assets as reproducible standard gzip. This is a native
/// build dependency only; browsers still use their built-in decompressor.
#[cfg(feature = "tools")]
pub fn gzip(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::{cell::RefCell, num::NonZeroU64};
    // Readable/minified adapters and their manifest reuse the same small Wasm.
    // Keep only the most recent small input, bounding retained memory without
    // hashes, persistent cache files or repeated expensive compression work.
    thread_local! {
        static LAST: RefCell<Option<(Vec<u8>, Vec<u8>)>> = const { RefCell::new(None) };
    }
    const CACHE_LIMIT: usize = 128 * 1024;
    if data.len() <= CACHE_LIMIT {
        if let Some(hit) = LAST.with_borrow(|last| {
            last.as_ref()
                .filter(|(input, _)| input == data)
                .map(|(_, output)| output.clone())
        }) {
            return Ok(hit);
        }
    }
    let options = zopfli::Options {
        iteration_count: NonZeroU64::new(100).unwrap(),
        ..zopfli::Options::default()
    };
    let mut output = Vec::new();
    zopfli::compress(options, zopfli::Format::Gzip, data, &mut output)
        .map_err(|error| error.to_string())?;
    if data.len() <= CACHE_LIMIT {
        LAST.with_borrow_mut(|last| *last = Some((data.to_vec(), output.clone())));
    }
    Ok(output)
}
