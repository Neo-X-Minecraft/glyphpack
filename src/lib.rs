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
#[cfg(feature = "tools")]
pub mod project;
#[cfg(feature = "tools")]
pub mod tooling;

pub mod transport;
