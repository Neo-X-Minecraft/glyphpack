//! 0BSD, NeoX. Reproducible public 10 MiB input for offline transport checks.
fn main() {
    let mut seed = 815u32;
    let bytes: Vec<u8> = (0..10 * 1024 * 1024)
        .map(|_| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 24) as u8
        })
        .collect();
    std::fs::write("generated/utf8-prefix/large.bin", bytes).unwrap();
}
