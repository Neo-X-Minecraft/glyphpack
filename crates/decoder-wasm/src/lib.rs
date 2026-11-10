//! Allocator-free synchronous Wasm decoder. Input/output arenas grow
//! geometrically and stay reusable; a lazily allocated high-digit table is
//! independent of both arenas. This module imports neither JS functions nor
//! Rust's standard allocator, exception formatting or I/O machinery.
#![no_std]
use core::cell::UnsafeCell;

#[allow(dead_code)]
#[path = "../../../src/hash.rs"]
mod hash;
mod unpack;

const RADIX: u64 = 63385;
const CHARACTER: u32 = 1;
const LENGTH: u32 = 2;
const HEADER: u32 = 3;
const PADDING: u32 = 4;
const MODE: u32 = 5;
#[cfg(feature = "fast")]
const CHECKSUM: u32 = 6;
#[cfg(feature = "secure")]
const DIGEST: u32 = 7;
const ALLOCATION: u32 = 8;

// This module has no imports or shared memory. Each exported operation is
// synchronous and cannot reenter JS; one instance therefore has one owner.
struct Shared<T>(UnsafeCell<T>);
unsafe impl<T> Sync for Shared<T> {}
static TABLE: Shared<[u16; 65536]> = Shared(UnsafeCell::new([0; 65536]));
static STATE: Shared<State> = Shared(UnsafeCell::new(State::new()));
extern "C" {
    static __heap_base: u8;
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

struct State {
    initialized: bool,
    heap_end: usize,
    input_ptr: usize,
    input_cap: usize,
    input_len: usize,
    output_ptr: usize,
    output_cap: usize,
    output_len: usize,
    high_ptr: usize,
    payload_length: usize,
}
fn digit(input: &[u16], table: &[u16], at: usize) -> Option<u16> {
    input.get(at).map(|&c| table[c as usize])
}
impl State {
    const fn new() -> Self {
        Self {
            initialized: false,
            heap_end: 0,
            input_ptr: 4,
            input_cap: 0,
            input_len: 0,
            output_ptr: 4,
            output_cap: 0,
            output_len: 0,
            high_ptr: 0,
            payload_length: 0,
        }
    }
    fn initialize(&mut self) {
        if self.initialized {
            return;
        }
        self.heap_end = core::ptr::addr_of!(__heap_base) as usize;
        let table = unsafe { &mut *TABLE.0.get() };
        let mut index = 0u16;
        // Keep the specified Unicode code-point bounds visible for format audits.
        #[allow(clippy::needless_range_loop)]
        for c in 32..65534 {
            if c == 60
                || (127..=159).contains(&c)
                || (55296..=57343).contains(&c)
                || (64976..=65007).contains(&c)
                || [65279, 8232, 8233].contains(&c)
            {
                continue;
            }
            index += 1;
            table[c] = index;
        }
        self.initialized = true;
    }
    // Geometric growth bounds lifetime arena waste by a small multiple of the
    // largest requested buffer. No per-call free list, GC hooks or allocator
    // bookkeeping enters the decoder. Checked arithmetic precedes memory.grow.
    fn allocate(&mut self, bytes: usize) -> Option<usize> {
        let start = self.heap_end.checked_add(7)? & !7;
        let end = start.checked_add(bytes)?;
        let pages = end.checked_add(65535)? / 65536;
        let current = core::arch::wasm32::memory_size::<0>();
        if pages > current && core::arch::wasm32::memory_grow::<0>(pages - current) == usize::MAX {
            return None;
        }
        self.heap_end = end;
        Some(start)
    }
    fn decode(&mut self, format_arg: u32, data_arg: u32, memory_arg: u32) -> u32 {
        let input =
            unsafe { core::slice::from_raw_parts(self.input_ptr as *const u16, self.input_len) };
        let table = unsafe { core::slice::from_raw_parts(TABLE.0.get().cast::<u16>(), 65536) };

        let verify_format =
            cfg!(feature = "format") && (!cfg!(feature = "format-runtime") || format_arg != 0);
        let verify_data = if cfg!(feature = "none")
            && (!cfg!(feature = "fast") && !cfg!(feature = "secure") || data_arg == 0)
        {
            0
        } else if cfg!(feature = "fast") && (!cfg!(feature = "secure") || data_arg == 1) {
            1
        } else if cfg!(feature = "secure") {
            2
        } else {
            0
        };
        let heavy = cfg!(feature = "memory-heavy")
            && (!cfg!(feature = "memory-runtime") || memory_arg != 0);
        // Preserve JS error priority: short header, characters, extended-header
        // canonicality, body parity, allocation bounds, then integrity policy.
        if verify_format && input.len() < 2 {
            return LENGTH;
        }
        let (Some(a), Some(b)) = (digit(input, table, 0), digit(input, table, 1)) else {
            return LENGTH;
        };
        if verify_format && (a == 0 || b == 0) {
            return CHARACTER;
        }
        let first = i64::from(a) - 1;
        let mut start = 2;
        let mut mode = 0;
        let length: i64;
        if cfg!(feature = "legacy") {
            length = first + RADIX as i64 * (i64::from(b) - 1);
        } else {
            mode = (first as u32) & 1023;
            if first < 32768 {
                length = ((first as u32) >> 10) as i64 * RADIX as i64 + i64::from(b) - 1;
            } else {
                if verify_format {
                    if first >= 33792 {
                        return HEADER;
                    }
                    if input.len() < 3 {
                        return LENGTH;
                    }
                }
                let Some(c) = digit(input, table, 2) else {
                    return LENGTH;
                };
                if verify_format && c == 0 {
                    return CHARACTER;
                }
                start = 3;
                length = i64::from(b) - 1 + RADIX as i64 * (i64::from(c) - 1);
                if verify_format && length < (32 * RADIX) as i64 {
                    return HEADER;
                }
            }
        }
        let kind = mode >> 8;
        let mask = mode as u8;
        let trailer = match kind {
            1 => 4,
            2 => 32,
            _ => 0,
        };
        if verify_format && (kind == 3 || (input.len() - start) % 2 != 0) {
            return LENGTH;
        }
        // Mandatory allocation safety: no body/header can amplify the output
        // beyond its available encoded capacity, even when checks are disabled.
        if length < trailer as i64
            || length < 0
            || length as u64 > ((input.len() - start) as u64) * 2
        {
            return LENGTH;
        }
        if verify_data != 0 && kind != verify_data {
            return MODE;
        }
        let length = length as usize;
        // Cache storage is committed only after header/allocation/policy guards.
        // Allocating a later arena never moves existing input/table addresses.
        if heavy && self.high_ptr == 0 {
            let Some(pointer) = self.allocate(65536 * 4) else {
                return ALLOCATION;
            };
            self.high_ptr = pointer;
            let high = unsafe { core::slice::from_raw_parts_mut(pointer as *mut u32, 65536) };
            for (c, &value) in table.iter().enumerate() {
                high[c] = if value == 0 {
                    0
                } else {
                    63385 * (u32::from(value) - 1) + 1
                };
            }
        }
        if length > self.output_cap {
            let capacity = length.checked_next_power_of_two().unwrap_or(length);
            let Some(pointer) = self.allocate(capacity) else {
                return ALLOCATION;
            };
            self.output_ptr = pointer;
            self.output_cap = capacity;
        }
        self.output_len = length;
        self.payload_length = length - trailer;
        let output = unsafe { core::slice::from_raw_parts_mut(self.output_ptr as *mut u8, length) };
        let high = if heavy {
            unsafe { core::slice::from_raw_parts(self.high_ptr as *const u32, 65536) }
        } else {
            &[]
        };
        let result = match (verify_format, heavy) {
            (false, false) => unpack::unpack::<false, false>(
                input,
                start,
                output,
                mask,
                table,
                high,
                verify_data != 0,
            ),
            (false, true) => unpack::unpack::<false, true>(
                input,
                start,
                output,
                mask,
                table,
                high,
                verify_data != 0,
            ),
            (true, false) => unpack::unpack::<true, false>(
                input,
                start,
                output,
                mask,
                table,
                high,
                verify_data != 0,
            ),
            (true, true) => unpack::unpack::<true, true>(
                input,
                start,
                output,
                mask,
                table,
                high,
                verify_data != 0,
            ),
        };
        if result != 0 {
            return result;
        }
        // Bounds are independent of the header parser, mirroring the JS
        // verifier's own exact-trailer assertion. All digest bytes must exist.
        if verify_data != 0
            && self.payload_length + if verify_data == 1 { 4 } else { 32 } != output.len()
        {
            return LENGTH;
        }
        #[cfg(feature = "fast")]
        if verify_data == 1 {
            let stored = u32::from_le_bytes(output[self.payload_length..].try_into().unwrap());
            if hash::xxhash32(&output[..self.payload_length]) != stored {
                return CHECKSUM;
            }
        }
        #[cfg(feature = "secure")]
        if verify_data == 2 {
            let digest = hash::blake3(&output[..self.payload_length]);
            let mut different = 0u8;
            for (i, &byte) in digest.iter().enumerate() {
                different |= byte ^ output[self.payload_length + i];
            }
            if different != 0 {
                return DIGEST;
            }
        }
        0
    }
}
/// Return a u16-aligned arena address, or zero when capacity cannot be reserved.
#[no_mangle]
pub extern "C" fn input_ptr(length: u32) -> u32 {
    let state = unsafe { &mut *STATE.0.get() };
    state.initialize();
    let bytes = match (length as usize).checked_mul(2) {
        Some(n) => n,
        None => return 0,
    };
    if bytes > state.input_cap {
        let capacity = bytes.checked_next_power_of_two().unwrap_or(bytes);
        let Some(pointer) = state.allocate(capacity) else {
            return 0;
        };
        state.input_ptr = pointer;
        state.input_cap = capacity;
    }
    state.input_len = length as usize;
    state.input_ptr as u32
}
#[no_mangle]
pub extern "C" fn decode(format: u32, data: u32, memory: u32) -> u32 {
    unsafe { (&mut *STATE.0.get()).decode(format, data, memory) }
}
#[no_mangle]
pub extern "C" fn output_ptr() -> u32 {
    unsafe { (*STATE.0.get()).output_ptr as u32 }
}
#[no_mangle]
pub extern "C" fn stored_len() -> u32 {
    unsafe { (*STATE.0.get()).output_len as u32 }
}
#[no_mangle]
pub extern "C" fn payload_len() -> u32 {
    unsafe { (*STATE.0.get()).payload_length as u32 }
}
