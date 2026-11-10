//! Demo-only browser encoder. Reuse the native encoder verbatim; this module
//! stays separate from the small decoder distributions. A module worker owns
//! its reusable input and output buffers, so encoding never blocks the page.
use std::cell::RefCell;
#[allow(dead_code)]
#[path = "../../../src/encoder.rs"]
mod encoder;
#[allow(dead_code)]
#[path = "../../../src/hash.rs"]
mod hash;

#[derive(Default)]
struct Buffers {
    input: Vec<u8>,
    output: Vec<u16>,
    error: String,
}
thread_local! { static BUFFERS: RefCell<Buffers> = RefCell::default(); }
#[no_mangle]
pub extern "C" fn input_ptr(length: u32) -> u32 {
    BUFFERS.with_borrow_mut(|b| {
        b.input.resize(length as usize, 0);
        b.input.as_mut_ptr() as usize as u32
    })
}
#[no_mangle]
pub extern "C" fn encode(mode: u32, exact: u32) -> u32 {
    BUFFERS.with_borrow_mut(|b| {
        let integrity = match mode {
            0 => encoder::Integrity::None,
            1 => encoder::Integrity::Fast,
            2 => encoder::Integrity::Secure,
            _ => return 1,
        };
        let options = encoder::EncodeOptions {
            integrity,
            effort: if exact != 0 {
                encoder::Effort::Full
            } else {
                encoder::Effort::Fast
            },
            ..encoder::EncodeOptions::default()
        };
        match encoder::encode_units(&b.input, &options) {
            Ok(output) => {
                b.output = output;
                b.error.clear();
                0
            }
            Err(error) => {
                b.error = error;
                2
            }
        }
    })
}
#[no_mangle]
pub extern "C" fn output_ptr() -> u32 {
    BUFFERS.with_borrow(|b| b.output.as_ptr() as usize as u32)
}
#[no_mangle]
pub extern "C" fn output_len() -> u32 {
    BUFFERS.with_borrow(|b| b.output.len() as u32)
}
#[no_mangle]
pub extern "C" fn error_ptr() -> u32 {
    BUFFERS.with_borrow(|b| b.error.as_ptr() as usize as u32)
}
#[no_mangle]
pub extern "C" fn error_len() -> u32 {
    BUFFERS.with_borrow(|b| b.error.len() as u32)
}
