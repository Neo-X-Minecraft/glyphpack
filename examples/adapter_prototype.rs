//! Compare a separately linked experimental kernel through the regular adapter.
use glyphpack::builder::{build_adapter, BuildOptions};
use std::{env, fs};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    let bytes = fs::read(&args[0])?;
    let source = build_adapter(&BuildOptions::full(), &bytes).map_err(std::io::Error::other)?;
    fs::write(&args[1], source)?;
    Ok(())
}
