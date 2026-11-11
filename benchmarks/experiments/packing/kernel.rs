//! 0BSD, NeoX. Experiment-only no_std Wasm adapter. All hashes are the unchanged
//! production implementation. Arena reuse and fresh returned JS buffers match it.
#![no_std]
use core::cell::UnsafeCell;
#[allow(dead_code)]
#[path = "../../../src/hash.rs"]
mod hash;
#[path = "core.rs"]
mod packing;
const fn setting(s: Option<&str>, fallback: u32) -> u32 {
    match s {
        None => fallback,
        Some(s) => {
            let b = s.as_bytes();
            let (mut n, mut i) = (0, 0);
            while i < b.len() {
                n = n * 10 + (b[i] - b'0') as u32;
                i += 1;
            }
            n
        }
    }
}
const METHOD: u32 = setting(option_env!("PACKING_METHOD"), 99);
const RADIX: u32 = setting(option_env!("PACKING_RADIX"), 254);
struct Shared<T>(UnsafeCell<T>);
unsafe impl<T> Sync for Shared<T> {}
static STATE: Shared<State> = Shared(UnsafeCell::new(State {
    end: 0,
    input: 0,
    icap: 0,
    output: 0,
    ocap: 0,
    size: 0,
    payload: 0,
}));
static TABLE: Shared<[u16; 65536]> = Shared(UnsafeCell::new([0; 65536]));
static READY: Shared<bool> = Shared(UnsafeCell::new(false));
extern "C" {
    static __heap_base: u8;
}
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
struct State {
    end: usize,
    input: usize,
    icap: usize,
    output: usize,
    ocap: usize,
    size: usize,
    payload: usize,
}
impl State {
    fn allocate(&mut self, n: usize) -> Option<usize> {
        if self.end == 0 {
            self.end = core::ptr::addr_of!(__heap_base) as usize;
        }
        let start = self.end.checked_add(7)? & !7;
        let end = start.checked_add(n)?;
        let pages = end.checked_add(65535)? / 65536;
        let old = core::arch::wasm32::memory_size::<0>();
        if pages > old && core::arch::wasm32::memory_grow::<0>(pages - old) == usize::MAX {
            return None;
        }
        self.end = end;
        Some(start)
    }
}
fn initialize() {
    unsafe {
        if *READY.0.get() {
            return;
        }
        let table = &mut *TABLE.0.get();
        let mut digit = 0;
        if RADIX > 256 {
            for c in 0..65536 {
                if [0, 13, 92, 96].contains(&c) || (55296..=57343).contains(&c) {
                    continue;
                }
                table[c] = digit + 1;
                digit += 1;
            }
            *READY.0.get() = true;
            return;
        }
        let c1 = [
            8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141, 381, 143,
            144, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 157, 382,
            376,
        ];
        for byte in 0..256 {
            if byte == 13 || byte == 96 || (RADIX == 253 && byte == 92) {
                continue;
            }
            let cp = if byte == 0 {
                65533
            } else if (128..160).contains(&byte) {
                c1[byte - 128]
            } else {
                byte
            };
            table[cp] = digit + 1;
            digit += 1;
        }
        *READY.0.get() = true;
    }
}
struct Unicode<'a> {
    text: &'a [u16],
    at: usize,
    table: &'a [u16],
}
impl packing::Digits for Unicode<'_> {
    #[inline(always)]
    fn read(&mut self) -> Result<u16, u32> {
        let c = *self.text.get(self.at).ok_or(1u32)?;
        self.at += 1;
        let d = self.table[c as usize];
        if d == 0 {
            return Err(1);
        }
        Ok(d - 1)
    }
    fn remaining(&self) -> usize {
        self.text.len() - self.at
    }
}
struct Utf8<'a> {
    data: &'a [u8],
    at: usize,
    left: usize,
    table: &'a [u16],
}
impl packing::Digits for Utf8<'_> {
    #[inline(always)]
    fn read(&mut self) -> Result<u16, u32> {
        if self.left == 0 {
            return Err(1);
        }
        let a = *self.data.get(self.at).ok_or(1u32)?;
        self.at += 1;
        let cp = if a < 128 {
            u32::from(a)
        } else {
            let count = if (194..224).contains(&a) {
                1
            } else if (224..240).contains(&a) {
                2
            } else {
                return Err(1);
            };
            let mut cp = u32::from(a & if count == 1 { 31 } else { 15 });
            for _ in 0..count {
                let b = *self.data.get(self.at).ok_or(1u32)?;
                self.at += 1;
                if b & 192 != 128 {
                    return Err(1);
                }
                cp = (cp << 6) | u32::from(b & 63);
            }
            if cp < if count == 1 { 128 } else { 2048 } || (55296..=57343).contains(&cp) {
                return Err(1);
            }
            cp
        };
        let d = self.table[cp as usize];
        if d == 0 {
            return Err(1);
        }
        self.left -= 1;
        if self.left == 0 && self.at != self.data.len() {
            return Err(1);
        }
        Ok(d - 1)
    }
    fn remaining(&self) -> usize {
        self.left
    }
}
fn run<D: packing::Digits>(input: &mut D, verify: u32) -> u32 {
    let settings = match packing::number(input, if RADIX > 256 { 1 } else { 2 }, RADIX) {
        Ok(v) => v as u32,
        Err(e) => return e,
    };
    let size = match packing::number(input, if RADIX > 256 { 2 } else { 4 }, RADIX) {
        Ok(v) => v as usize,
        Err(e) => return e,
    };
    let kind = (settings >> 8) & 3;
    let mask = settings as u8;
    let trailer = match kind {
        0 => 0,
        1 => 4,
        2 => 32,
        _ => return 1,
    };
    if settings >> 10 != METHOD
        || size < trailer
        || size > input.remaining() * if RADIX > 256 { 2 } else { 1 }
    {
        return 1;
    }
    if verify != 0 && verify != kind {
        return 2;
    }
    let ptr = output_ptr(size);
    if ptr == 0 && size > 0 {
        return 3;
    }
    unsafe {
        (*STATE.0.get()).size = size;
        (*STATE.0.get()).payload = size - trailer;
    }
    let out = unsafe { core::slice::from_raw_parts_mut(ptr as *mut u8, size) };
    if let Err(e) = packing::decode(input, out, mask, RADIX, METHOD) {
        return e;
    }
    check(size, kind, verify)
}
#[no_mangle]
pub extern "C" fn input_ptr(bytes: usize) -> usize {
    let s = unsafe { &mut *STATE.0.get() };
    if bytes > s.icap {
        let cap = bytes.checked_next_power_of_two().unwrap_or(bytes);
        let Some(p) = s.allocate(cap) else { return 0 };
        s.input = p;
        s.icap = cap;
    }
    if s.input == 0 {
        4
    } else {
        s.input
    }
}
#[no_mangle]
pub extern "C" fn output_ptr(bytes: usize) -> usize {
    let s = unsafe { &mut *STATE.0.get() };
    if bytes > s.ocap {
        let cap = bytes.checked_next_power_of_two().unwrap_or(bytes);
        let Some(p) = s.allocate(cap) else { return 0 };
        s.output = p;
        s.ocap = cap;
    }
    if s.output == 0 {
        4
    } else {
        s.output
    }
}
#[no_mangle]
pub extern "C" fn decode(units: usize, digit_input: u32, verify: u32, utf8_bytes: usize) -> u32 {
    if METHOD == 99 {
        return 1;
    }
    let s = unsafe { &*STATE.0.get() };
    if digit_input == 3 {
        if utf8_bytes > s.icap
            || units > utf8_bytes
            || units.checked_mul(3).is_none_or(|n| utf8_bytes > n)
        {
            return 1;
        }
        initialize();
        let input = unsafe {
            core::slice::from_raw_parts(
                if s.input == 0 { 4 } else { s.input } as *const u8,
                utf8_bytes,
            )
        };
        return run(
            &mut Utf8 {
                data: input,
                at: 0,
                left: units,
                table: unsafe { &*TABLE.0.get() },
            },
            verify,
        );
    }
    if units
        .checked_mul(if digit_input == 0 { 2 } else { 1 })
        .is_none_or(|n| n > s.icap)
    {
        return 1;
    }
    if digit_input == 0 {
        initialize();
        let input = unsafe {
            core::slice::from_raw_parts(if s.input == 0 { 4 } else { s.input } as *const u16, units)
        };
        run(
            &mut Unicode {
                text: input,
                at: 0,
                table: unsafe { &*TABLE.0.get() },
            },
            verify,
        )
    } else {
        let input = unsafe {
            core::slice::from_raw_parts(if s.input == 0 { 4 } else { s.input } as *const u8, units)
        };
        run(
            &mut packing::Slice {
                data: input,
                at: 0,
                radix: RADIX,
            },
            verify,
        )
    }
}
#[no_mangle]
pub extern "C" fn stored_len() -> usize {
    unsafe { (*STATE.0.get()).size }
}
#[no_mangle]
pub extern "C" fn payload_len() -> usize {
    unsafe { (*STATE.0.get()).payload }
}
#[no_mangle]
pub extern "C" fn check(size: usize, kind: u32, verify: u32) -> u32 {
    let trailer = match kind {
        0 => 0,
        1 => 4,
        2 => 32,
        _ => return 1,
    };
    let s = unsafe { &*STATE.0.get() };
    if size > s.ocap || size < trailer {
        return 1;
    }
    if verify == 0 {
        return 0;
    }
    if verify != kind {
        return 2;
    }
    let data = unsafe { core::slice::from_raw_parts(s.output as *const u8, size) };
    let end = size - trailer;
    if kind == 1 {
        let expected = u32::from_le_bytes(data[end..].try_into().unwrap());
        if hash::xxhash32(&data[..end]) != expected {
            return 4;
        }
    } else if kind == 2 {
        let digest = hash::blake3(&data[..end]);
        let mut diff = 0u8;
        for i in 0..32 {
            diff |= digest[i] ^ data[end + i];
        }
        if diff != 0 {
            return 4;
        }
    }
    0
}
