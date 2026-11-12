//! 0BSD, NeoX. UTF-8 byte-input kernel; TextEncoder.encodeInto fills reserved memory.
//! No imports/allocator; a growing input+output region reuses the same base.
//! Benchmark-only, with unshared memory and no imported callbacks or threads.
//! Excluded from delivered builds after crashes in the tested Chromium renderer.
#![no_std]
use core::cell::UnsafeCell;
struct Shared<T>(UnsafeCell<T>);
unsafe impl<T> Sync for Shared<T> {}
static STATE: Shared<State> = Shared(UnsafeCell::new(State {
    cap: 0,
    len: 0,
    profile: usize::MAX,
    out_len: 0,
}));
static BAD_LOW: Shared<[u8; 16]> = Shared(UnsafeCell::new([0; 16]));
static TABLE: Shared<[u32; 2048]> = Shared(UnsafeCell::new([0; 2048]));
const PROFILES: [&[u8]; 6] = [
    &[0, 10, 13, 34, 38, 60, 92],
    &[0, 10, 13, 34, 38, 60, 92, 127],
    &[0, 10, 13, 34, 38, 60, 92, 96, 127],
    &[0, 10, 13, 34, 38, 39, 60, 92, 96, 127],
    &[0, 10, 13, 34, 36, 38, 39, 60, 92, 96, 127],
    &[0, 10, 13, 34, 36, 39, 60, 92, 96, 127],
];
const PORTABLE_RANGES: [(u16, u16); 37] = [
    (160, 173),
    (174, 768),
    (880, 884),
    (885, 888),
    (890, 894),
    (895, 896),
    (900, 903),
    (904, 907),
    (908, 909),
    (910, 930),
    (931, 1155),
    (1162, 1328),
    (1329, 1367),
    (1369, 1419),
    (1421, 1424),
    (1470, 1471),
    (1472, 1473),
    (1475, 1476),
    (1478, 1479),
    (1488, 1515),
    (1519, 1525),
    (1542, 1552),
    (1563, 1564),
    (1565, 1611),
    (1632, 1648),
    (1649, 1750),
    (1758, 1759),
    (1765, 1767),
    (1769, 1770),
    (1774, 1806),
    (1808, 1809),
    (1810, 1840),
    (1869, 1958),
    (1969, 1970),
    (1984, 2027),
    (2036, 2043),
    (2046, 2048),
];
const PORTABLE: [u16; 1547] = {
    let mut out = [0; 1547];
    let mut n = 0;
    let mut i = 0;
    while i < PORTABLE_RANGES.len() {
        let mut c = PORTABLE_RANGES[i].0;
        while c < PORTABLE_RANGES[i].1 {
            out[n] = c;
            n += 1;
            c += 1;
        }
        i += 1;
    }
    out
};
struct State {
    cap: usize,
    len: usize,
    profile: usize,
    out_len: usize,
}
extern "C" {
    static __heap_base: u8;
}
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
#[no_mangle]
pub extern "C" fn reserve(len: usize) -> usize {
    if len > 1 << 28 {
        return 0;
    }
    unsafe {
        let state = &mut *STATE.0.get();
        let base = core::ptr::addr_of!(__heap_base) as usize;
        if len > state.cap {
            let cap = len.next_power_of_two();
            let pages = (base + cap * 4).div_ceil(65536);
            let current = core::arch::wasm32::memory_size::<0>();
            if pages > current
                && core::arch::wasm32::memory_grow::<0>(pages - current) == usize::MAX
            {
                return 0;
            }
            state.cap = cap;
        }
        state.len = len;
        state.out_len = 0;
        base
    }
}
#[no_mangle]
pub extern "C" fn output_ptr() -> usize {
    unsafe { core::ptr::addr_of!(__heap_base) as usize + (*STATE.0.get()).cap * 2 }
}
#[no_mangle]
pub extern "C" fn output_len() -> usize {
    unsafe { (*STATE.0.get()).out_len }
}
fn digit(c: u8) -> Option<u32> {
    match c {
        65..=90 => Some(u32::from(c - 65)),
        97..=122 => Some(u32::from(c - 97 + 26)),
        48..=57 => Some(u32::from(c - 48 + 52)),
        45 => Some(62),
        95 => Some(63),
        _ => None,
    }
}
fn initialize(state: &mut State, profile: usize) {
    if state.profile == profile {
        return;
    }
    let forbidden = PROFILES[profile];
    let bad = unsafe { &mut *BAD_LOW.0.get() };
    bad.fill(0);
    for &c in forbidden {
        bad[usize::from(c & 15)] |= 1 << (c >> 4);
    }
    let radix = (if profile == 5 { 1547 } else { 1888 } / forbidden.len()).min(256) as u32;
    let base = radix.ilog2();
    let cut = (1 << (base + 1)) - radix;
    let table = unsafe { &mut *TABLE.0.get() };
    table.fill(0);
    for c in 1..128u16 {
        if !forbidden.contains(&(c as u8)) {
            table[c as usize] = u32::from(c) | (7 << 16);
        }
    }
    for (index, &prefix) in forbidden.iter().enumerate() {
        for d in 0..radix {
            let (width, tail) = if d < cut {
                (base, d)
            } else {
                (base + 1, d + cut)
            };
            let digit = index * radix as usize + d as usize;
            let cp = if profile == 5 {
                PORTABLE[digit] as usize
            } else {
                160 + digit
            };
            table[cp] = (u32::from(prefix) << width) | tail | ((7 + width) << 16);
        }
    }
    state.profile = profile;
}
#[no_mangle]
pub extern "C" fn input_capacity() -> usize {
    unsafe { (*STATE.0.get()).cap * 2 }
}
#[no_mangle]
pub extern "C" fn decode(written: usize) -> u32 {
    let state = unsafe { &mut *STATE.0.get() };
    if written > state.cap * 2 {
        return 2;
    }
    let input = unsafe { core::slice::from_raw_parts(core::ptr::addr_of!(__heap_base), written) };
    if input.len() < 7 || input[..3] != [126, 117, 49] {
        return 3;
    }
    let Some(profile) = digit(input[3]).filter(|&v| v < 6) else {
        return 9;
    };
    let (Some(a), Some(b)) = (digit(input[4]), digit(input[5]).filter(|&v| v < 4)) else {
        return 3;
    };
    let mask = (a | (b << 6)) as u8;
    let (mut pos, mut length, mut shift) = (6usize, 0u64, 0u32);
    loop {
        let Some(d) = input.get(pos).and_then(|&c| digit(c)) else {
            return 2;
        };
        pos += 1;
        if shift > 30 {
            return 2;
        }
        length |= u64::from(d & 31) << shift;
        if d & 32 == 0 {
            if shift != 0 && d & 31 == 0 {
                return 3;
            }
            break;
        }
        shift += 5;
    }
    if length > 0x40000000 || length > ((input.len() - pos) * 15 / 8) as u64 {
        return 2;
    }
    initialize(state, profile as usize);
    let table = unsafe { &*TABLE.0.get() };
    let output = (core::ptr::addr_of!(__heap_base) as usize + state.cap * 2) as *mut u8;
    let (mut queue, mut bits, mut at, mut last) = (0u32, 0u32, 0usize, 0u32);
    let start = pos;
    use core::arch::wasm32::*;
    let low = unsafe { v128_load((*BAD_LOW.0.get()).as_ptr().cast()) };
    let high = u8x16(1, 2, 4, 8, 16, 32, 64, 128, 0, 0, 0, 0, 0, 0, 0, 0);
    while pos < input.len() {
        if pos + 16 <= input.len() {
            let chars = unsafe { v128_load(input.as_ptr().add(pos).cast()) };
            if i8x16_bitmask(chars) == 0 {
                // Nibble bitsets validate all sixteen ASCII bytes in parallel.
                // Wide bytes instead take the scalar UTF-8 validation path.
                let rejected = v128_and(
                    i8x16_swizzle(low, v128_and(chars, u8x16_splat(15))),
                    i8x16_swizzle(high, u8x16_shr(chars, 4)),
                );
                if v128_any_true(rejected) {
                    return 1;
                }
                for delta in [0, 8] {
                    let packed = unsafe {
                        input
                            .as_ptr()
                            .add(pos + delta)
                            .cast::<u64>()
                            .read_unaligned()
                    };
                    let mut word = packed.swap_bytes();
                    // Compress unused high bits: 14-bit pairs, 28-bit groups,
                    // then one 56-bit word. Byte order matches scalar MSB-first.
                    word = (word & 0x007f007f007f007f) | ((word & 0x7f007f007f007f00) >> 1);
                    word = (word & 0x00003fff00003fff) | ((word & 0x3fff00003fff0000) >> 2);
                    word = (word & 0x000000000fffffff) | ((word & 0x0fffffff00000000) >> 4);
                    word |= u64::from(queue & ((1 << bits) - 1)) << 56;
                    let emitted = (word >> bits) << 8;
                    unsafe {
                        output.add(at).cast::<u64>().write_unaligned(
                            (emitted ^ (u64::from(mask) * 0x0101010101010101)).to_be(),
                        );
                    }
                    queue = word as u32 & ((1 << bits) - 1);
                    at += 7;
                }
                pos += 16;
                last = 7;
                continue;
            }
        }
        if pos + 8 <= input.len() {
            let p = unsafe { input.as_ptr().add(pos).cast::<u64>().read_unaligned() };
            if p & 0x8080808080808080 == 0 {
                let a = (p & 127) as usize;
                let b = ((p >> 8) & 127) as usize;
                let c = ((p >> 16) & 127) as usize;
                let d = ((p >> 24) & 127) as usize;
                let e = ((p >> 32) & 127) as usize;
                let f = ((p >> 40) & 127) as usize;
                let g = ((p >> 48) & 127) as usize;
                let h = ((p >> 56) & 127) as usize;
                if table[a]
                    & table[b]
                    & table[c]
                    & table[d]
                    & table[e]
                    & table[f]
                    & table[g]
                    & table[h]
                    & 65536
                    == 0
                {
                    return 1;
                }
                let word = (u64::from(queue & ((1 << bits) - 1)) << 56)
                    | ((a as u64) << 49)
                    | ((b as u64) << 42)
                    | ((c as u64) << 35)
                    | ((d as u64) << 28)
                    | ((e as u64) << 21)
                    | ((f as u64) << 14)
                    | ((g as u64) << 7)
                    | h as u64;
                let emitted = (word >> bits) << 8;
                unsafe {
                    output.add(at).cast::<u64>().write_unaligned(
                        (emitted ^ (u64::from(mask) * 0x0101010101010101)).to_be(),
                    );
                }
                queue = word as u32 & ((1 << bits) - 1);
                at += 7;
                pos += 8;
                last = 7;
                continue;
            }
        }
        if pos + 4 <= input.len() {
            let packed = unsafe { input.as_ptr().add(pos).cast::<u32>().read_unaligned() };
            if packed & 0x80808080 == 0 {
                let a = (packed & 127) as usize;
                let b = ((packed >> 8) & 127) as usize;
                let c = ((packed >> 16) & 127) as usize;
                let d = ((packed >> 24) & 127) as usize;
                if table[a] & table[b] & table[c] & table[d] & 65536 == 0 {
                    return 1;
                }
                let word = (u64::from(queue & ((1 << bits) - 1)) << 28)
                    | ((a as u64) << 21)
                    | ((b as u64) << 14)
                    | ((c as u64) << 7)
                    | d as u64;
                let count = (bits + 28) >> 3;
                bits = (bits + 28) & 7;
                let emitted = (word >> bits) as u32;
                let value = if count == 3 { emitted << 8 } else { emitted };
                unsafe {
                    output
                        .add(at)
                        .cast::<u32>()
                        .write_unaligned((value ^ (u32::from(mask) * 0x01010101)).to_be());
                }
                queue = word as u32 & ((1 << bits) - 1);
                at += count as usize;
                pos += 4;
                last = 7;
                continue;
            }
        }
        let first = input[pos];
        pos += 1;
        let c = if first < 128 {
            first as usize
        } else {
            if !(0xc2..=0xdf).contains(&first) || pos == input.len() {
                return 1;
            }
            let tail = input[pos];
            pos += 1;
            if tail & 0xc0 != 0x80 {
                return 1;
            }
            (usize::from(first & 31) << 6) | usize::from(tail & 63)
        };
        let entry = table.get(c).copied().unwrap_or(0);
        if entry == 0 {
            return 1;
        }
        let width = entry >> 16;
        queue = (queue << width) | (entry & 32767);
        bits += width;
        last = width;
        if bits >= 8 {
            bits -= 8;
            // SAFETY: at most 15 bits per input unit; reserve() provides two
            // output bytes per reserved unit even for malformed excess bodies.
            unsafe {
                output.add(at).write((queue >> bits) as u8 ^ mask);
            }
            at += 1;
            if bits >= 8 {
                bits -= 8;
                unsafe {
                    output.add(at).write((queue >> bits) as u8 ^ mask);
                }
                at += 1;
            }
        }
    }
    let total = at * 8 + bits as usize;
    if total < length as usize * 8 {
        return 2;
    }
    let padding = total - length as usize * 8;
    if (input.len() > start && padding >= last as usize) || (queue & ((1u32 << padding) - 1)) != 0 {
        return 4;
    }
    state.out_len = length as usize;
    0
}
