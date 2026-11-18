//! GlyphPack encodes arbitrary bytes as dense BMP text for a Rust/Wasm decoder.
//!
//! Encoding, HTML injection and Wasm decoder compilation are independent operations.
//! Format checking and unkeyed BLAKE3 integrity are the decoder's defaults;
//! allocation safety remains mandatory in every generated profile.
#[cfg(feature = "tools")]
pub mod builder;
pub mod encoder;
pub mod hash;
pub mod injector;
pub mod packing;
#[cfg(feature = "tools")]
pub mod project;
#[cfg(feature = "tools")]
pub mod tooling;

pub mod transport;
pub mod utf8_compact;
/// Explicitly raw UTF-8 transport; secure encoder defaults are unchanged.
pub mod utf8_raw;
