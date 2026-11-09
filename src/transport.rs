//! Native transport helpers for build output. The browser reverses gzip with
//! its built-in DecompressionStream and base64 with its built-in byte decoder.
use std::{
    io::Write,
    process::{Command, Stdio},
};

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

/// Invoke native gzip at its maximum standard level. -n removes the filename
/// and timestamp, making the same Wasm input produce a reproducible gzip member.
pub fn gzip9(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut child = Command::new("gzip")
        .args(["-9", "-n", "-c"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Native gzip is required: {e}"))?;
    let mut input = child.stdin.take().unwrap();
    // Drain output while feeding input, so larger/incompressible inputs cannot
    // fill both process pipes and deadlock. The scoped writer borrows data.
    std::thread::scope(|scope| {
        let writer = scope.spawn(move || input.write_all(data));
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        let written = writer.join().map_err(|_| "gzip input thread failed")?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into());
        }
        written.map_err(|e| e.to_string())?;
        Ok(output.stdout)
    })
}
