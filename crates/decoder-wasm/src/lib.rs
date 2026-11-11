//! Allocator-free synchronous Wasm decoder. Input/output arenas grow
//! geometrically and stay reusable; a lazily allocated high-digit table is
//! independent of both arenas. This module imports neither JS functions nor
//! Rust's standard allocator, exception formatting or I/O machinery.
#![no_std]
use core::cell::UnsafeCell;

#[cfg(feature = "ans")]
mod ans;
#[allow(dead_code)]
#[path = "../../../src/hash.rs"]
mod hash;
#[allow(dead_code)]
#[path = "../../../src/packing.rs"]
mod packing;
#[cfg(feature = "pair")]
mod unpack;
#[cfg(feature = "windows")]
mod windows;

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
const CODEC: u32 = 9;

// This module has no imports or shared memory. Each exported operation is
// synchronous and cannot reenter JS; one instance therefore has one owner.
struct Shared<T>(UnsafeCell<T>);
unsafe impl<T> Sync for Shared<T> {}
#[cfg(any(feature = "pair", feature = "ans"))]
static TABLE: Shared<[u16; 65536]> = Shared(UnsafeCell::new([0; 65536]));
#[cfg(feature = "windows")]
static WINDOWS_TABLE: Shared<[u16; 65536]> = Shared(UnsafeCell::new([0; 65536]));
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
    windows_initialized: bool,
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
fn lookup_table(windows: bool) -> &'static [u16] {
    #[cfg(feature = "windows")]
    if windows {
        return unsafe { &*WINDOWS_TABLE.0.get() };
    }
    #[cfg(any(feature = "pair", feature = "ans"))]
    {
        return unsafe { &*TABLE.0.get() };
    }
    #[allow(unreachable_code)]
    &[]
}
#[inline(always)]
fn read_digit<const FORMAT: bool>(
    input: &[u16],
    pos: &mut usize,
    table: &[u16],
) -> Result<u64, u32> {
    let Some(&c) = input.get(*pos) else {
        return Err(LENGTH);
    };
    *pos += 1;
    let d = table[c as usize];
    if FORMAT && d == 0 {
        return Err(CHARACTER);
    }
    Ok(u64::from(d).wrapping_sub(1))
}
impl State {
    const fn new() -> Self {
        Self {
            initialized: false,
            windows_initialized: false,
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
    fn prepare_heap(&mut self) {
        if self.heap_end == 0 {
            self.heap_end = core::ptr::addr_of!(__heap_base) as usize;
        }
    }
    fn initialize(&mut self, windows: bool) {
        self.prepare_heap();
        #[cfg(feature = "windows")]
        if windows {
            if !self.windows_initialized {
                let table = unsafe { &mut *WINDOWS_TABLE.0.get() };
                let mut index = 0;
                for b in 0..=255u8 {
                    if b == 13 || b == 60 {
                        continue;
                    }
                    index += 1;
                    table[packing::windows_code_point(b) as usize] = index;
                }
                // Raw TextDecoder input contains NUL, while HTML replaces it
                // with U+FFFD. Both explicitly represent the same source digit.
                table[0] = 1;
                self.windows_initialized = true;
            }
            return;
        }
        #[cfg(any(feature = "pair", feature = "ans"))]
        {
            if self.initialized {
                return;
            }
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
    // Shared by explicit warm-up and lazy decode initialization. This cache
    // never aliases the input/output arenas, and is committed only once.
    fn initialize_high(&mut self) -> u32 {
        if self.high_ptr == 0 {
            let Some(pointer) = self.allocate(65536 * 4) else {
                return ALLOCATION;
            };
            self.high_ptr = pointer;
            let table = lookup_table(false);
            // SAFETY: allocate reserved an aligned region of exactly this size.
            let high = unsafe { core::slice::from_raw_parts_mut(pointer as *mut u32, 65536) };
            for (c, &value) in table.iter().enumerate() {
                high[c] = if value == 0 {
                    0
                } else {
                    63385 * (u32::from(value) - 1) + 1
                };
            }
        }
        0
    }
    fn warmup(&mut self, codecs: u32) -> u32 {
        // A bit per compiled codec: pair=1, ans=2, windows=4. Reject the whole
        // request before allocating or initializing any selected cache.
        let available = u32::from(cfg!(feature = "pair"))
            | (u32::from(cfg!(feature = "ans")) << 1)
            | (u32::from(cfg!(feature = "windows")) << 2);
        if codecs & !available != 0 {
            return CODEC;
        }
        // Pair and UTF-16 ANS deliberately share their alphabet table.
        if codecs & 3 != 0 {
            self.initialize(false);
        }
        if codecs & 4 != 0 {
            self.initialize(true);
        }
        if codecs & 1 != 0 && cfg!(feature = "memory-heavy") {
            return self.initialize_high();
        }
        0
    }
    fn decode(&mut self, format_arg: u32, data_arg: u32, memory_arg: u32) -> u32 {
        let input =
            unsafe { core::slice::from_raw_parts(self.input_ptr as *const u16, self.input_len) };
        if input.len() < 2 {
            return LENGTH;
        }
        let (codec, tagged) = match input[0] {
            packing::PAIR_TAG => (1, true),
            packing::ANS_TAG => (2, true),
            packing::WINDOWS_TAG => (3, true),
            _ => (1, false),
        };
        if (codec == 1 && !cfg!(feature = "pair"))
            || (codec == 2 && !cfg!(feature = "ans"))
            || (codec == 3 && !cfg!(feature = "windows"))
            || (tagged && cfg!(feature = "legacy"))
        {
            return CODEC;
        }
        let input = if tagged { &input[1..] } else { input };
        self.initialize(codec == 3);
        let table = lookup_table(codec == 3);

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
        let heavy = codec == 1
            && cfg!(feature = "memory-heavy")
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
        if codec == 3 {
            if input.len() < 6 {
                return LENGTH;
            }
            let (mut settings, mut power) = (0i64, 1i64);
            for &c in &input[..2] {
                let d = i64::from(table[c as usize]);
                if verify_format && d == 0 {
                    return CHARACTER;
                }
                settings += (d - 1) * power;
                power *= 254;
            }
            if !(0..1024).contains(&settings) {
                return HEADER;
            }
            mode = settings as u32;
            start = 6;
            let (mut n, mut power) = (0i64, 1i64);
            for &c in &input[2..6] {
                let d = i64::from(table[c as usize]);
                if verify_format && d == 0 {
                    return CHARACTER;
                }
                n += (d - 1) * power;
                power *= 254;
            }
            length = n;
        } else if cfg!(feature = "legacy") {
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
        if verify_format && (kind == 3 || (codec == 1 && (input.len() - start) % 2 != 0)) {
            return LENGTH;
        }
        // Mandatory allocation safety: no body/header can amplify the output
        // beyond its available encoded capacity, even when checks are disabled.
        let available = input.len() - start;
        let capacity = match codec {
            2 => available.saturating_sub(12) * 2,
            3 => available.saturating_sub(16),
            _ => available * 2,
        };
        if length < trailer as i64 || length < 0 || length as u64 > capacity as u64 {
            return LENGTH;
        }
        if verify_data != 0 && kind != verify_data {
            return MODE;
        }
        let length = length as usize;
        // Cache storage is committed only after header/allocation/policy guards.
        // Allocating a later arena never moves existing input/table addresses.
        if heavy {
            let result = self.initialize_high();
            if result != 0 {
                return result;
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
        let result = match codec {
            #[cfg(feature = "ans")]
            2 => {
                if verify_format {
                    ans::unpack::<true>(input, start, output, mask, table)
                } else {
                    ans::unpack::<false>(input, start, output, mask, table)
                }
            }
            #[cfg(feature = "windows")]
            3 => {
                if verify_format {
                    windows::unpack::<true>(input, start, output, mask, table)
                } else {
                    windows::unpack::<false>(input, start, output, mask, table)
                }
            }
            #[cfg(feature = "pair")]
            1 => match (verify_format, heavy) {
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
            },
            _ => CODEC,
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
    state.prepare_heap();
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
/// Initialize selected codec caches without changing any input/output state.
/// Repeated calls reuse the same tables. Payload-sized arenas remain lazy.
#[no_mangle]
pub extern "C" fn warmup(codecs: u32) -> u32 {
    unsafe { (&mut *STATE.0.get()).warmup(codecs) }
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
