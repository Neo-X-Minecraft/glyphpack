//! 0BSD, NeoX. UTF-8 ~u2 body kernel. The wrapper owns memory and proves all
//! input/output ranges; no allocator, callbacks, threads or mutable JS imports.
//! The maximum table/stack address is below the wrapper's 64 KiB arena base.
#![no_std]
#[allow(dead_code)]
#[path = "../../src/utf8-raw/alphabet.rs"]
mod alphabet;
static mut TABLE: [i16; 2048] = [0; 2048];
#[cfg(simd)]
// Each eight-symbol lap emits seven mandatory bytes plus one per wide symbol.
// A 256-row swizzle selects those bytes; 128 means zero-fill unused lanes.
static SHUFFLES: [[u8; 16]; 256] = {
    let mut rows = [[128u8; 16]; 256];
    let mut flags = 0;
    while flags < 256 {
        let (mut i, mut at) = (0, 0);
        while i < 8 {
            if i > 0 {
                rows[flags][at] = (2 * i) as u8;
                at += 1;
            }
            if flags & (1 << i) != 0 {
                rows[flags][at] = (2 * i + 1) as u8;
                at += 1;
            }
            i += 1;
        }
        flags += 1;
    }
    rows
};
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
pub unsafe extern "C" fn init() {
    let table = core::ptr::addr_of_mut!(TABLE).cast::<i16>();
    for c in 1..128usize {
        if ![0, 10, 13, 34, 38, 92].contains(&c) {
            table.add(c).write(
                (if cfg!(tokens) {
                    (c << 8) | c
                } else {
                    0x8000 | (c << 8) | c
                }) as i16,
            );
        }
    }
    let mut ordinal = 0usize;
    for (begin, end) in alphabet::PORTABLE_RANGES {
        for c in begin..end {
            if ordinal == 1536 {
                return;
            }
            let prefix = [0usize, 10, 13, 34, 38, 92][ordinal >> 8];
            table
                .add(c as usize)
                .write((0x8000 | (prefix << 8) | (ordinal & 255)) as i16);
            ordinal += 1;
        }
    }
}
#[no_mangle]
pub extern "C" fn table_ptr() -> usize {
    core::ptr::addr_of!(TABLE) as usize
}

// Native TextEncoder creates well-formed UTF-8, including replacement of lone
// surrogates. Three/four-byte scalars cannot belong to this frozen alphabet.
#[allow(dead_code)]
#[inline(always)]
unsafe fn symbol(input: usize, pos: &mut usize, count: usize) -> u32 {
    #[cfg(utf16)]
    {
        let _ = count;
        let cp = (input as *const u16).add(*pos).read() as u32;
        *pos += 1;
        cp
    }
    #[cfg(not(utf16))]
    {
        let first = (input as *const u8).add(*pos).read() as u32;
        *pos += 1;
        if first < 128 {
            first
        } else {
            if first >= 224 || *pos >= count {
                return 2048;
            }
            let second = (input as *const u8).add(*pos).read() as u32;
            *pos += 1;
            ((first & 31) << 6) | (second & 63)
        }
    }
}
#[inline(always)]
unsafe fn entry(input: usize, pos: &mut usize, count: usize, valid: &mut i32) -> (u32, bool) {
    #[cfg(tokens)]
    {
        let _ = count;
        let e = (input as *const u16).add(*pos).read() as u32;
        *pos += 1;
        *valid &= if e == 0 { 0 } else { -1 };
        return (e & 32767, e >> 15 != 0);
    }
    #[cfg(not(tokens))]
    {
        let cp = symbol(input, pos, count);
        if cp >= 2048 {
            *valid = 0;
            return (0, cp >= 128);
        }
        let e = core::ptr::addr_of!(TABLE)
            .cast::<i16>()
            .add(cp as usize)
            .read() as i32;
        *valid &= e;
        ((e as u32) & 32767, cp >= 128)
    }
}
#[inline(always)]
unsafe fn store(out: *mut u8, at: &mut usize, data: u32, mask: u32, expected: usize) {
    if *at < expected {
        out.add(*at).write((data ^ mask) as u8);
    }
    *at += 1;
}

#[no_mangle]
pub unsafe extern "C" fn decode(
    input: usize,
    count: usize,
    output: usize,
    expected: usize,
    mask: u32,
) -> u32 {
    let out = output as *mut u8;
    let (mut pos, mut at, mut valid, mut last, mut width) = (0usize, 0usize, -1i32, 0u32, 7u32);
    #[cfg(simd)]
    {
        use core::arch::wasm32::*;
        while pos + 8 <= count && at + 15 <= expected {
            let entries = v128_load((input as *const u16).add(pos).cast());
            let bad = i16x8_bitmask(i16x8_eq(entries, i16x8_splat(0)));
            if bad != 0 {
                valid = 0;
            }
            let flags = i16x8_bitmask(entries);
            let values = v128_and(entries, i16x8_splat(32767));
            // Scaling data_i by 2^(i+1) places its optional byte in byte 1.
            // Its byte 2 and the previous product's byte 0 form the mandatory
            // byte. All phase shifts become fixed SIMD lane multiplications.
            let low = i32x4_mul(u32x4_extend_low_u16x8(values), i32x4(2, 4, 8, 16));
            let high = i32x4_mul(u32x4_extend_high_u16x8(values), i32x4(32, 64, 128, 256));
            let current = i8x16_shuffle::<2, 1, 6, 5, 10, 9, 14, 13, 18, 17, 22, 21, 26, 25, 30, 29>(
                low, high,
            );
            let previous =
                i8x16_shuffle::<0, 0, 0, 0, 4, 0, 8, 0, 12, 0, 16, 0, 20, 0, 24, 0>(low, high);
            let merged = v128_or(current, v128_and(previous, i16x8_splat(255)));
            let permutation = v128_load(SHUFFLES.as_ptr().add(flags as usize).cast());
            let packed = i8x16_swizzle(merged, permutation);
            v128_store(
                out.add(at).cast(),
                v128_xor(packed, i8x16_splat(mask as i8)),
            );
            at += 7 + flags.count_ones() as usize;
            pos += 8;
            last = u16x8_extract_lane::<7>(entries) as u32 & 32767;
            width = if flags & 128 != 0 { 15 } else { 7 };
        }
    }
    #[cfg(not(any(scalar, high, simd)))]
    while pos + 16 <= count && at + 15 <= expected {
        #[cfg(all(ascii8, not(utf16)))]
        {
            let bytes = (input as *const u8)
                .add(pos)
                .cast::<u64>()
                .read_unaligned()
                .to_be();
            if bytes & 0x8080808080808080 == 0 {
                let table = core::ptr::addr_of!(TABLE).cast::<i16>();
                for j in 0..8 {
                    valid &= table.add(((bytes >> (j * 8)) & 127) as usize).read() as i32;
                }
                let word = ((bytes & 0x7f00000000000000) << 1)
                    | ((bytes & 0x007f000000000000) << 2)
                    | ((bytes & 0x00007f0000000000) << 3)
                    | ((bytes & 0x0000007f00000000) << 4)
                    | ((bytes & 0x000000007f000000) << 5)
                    | ((bytes & 0x00000000007f0000) << 6)
                    | ((bytes & 0x0000000000007f00) << 7)
                    | ((bytes & 127) << 8);
                out.add(at)
                    .cast::<u64>()
                    .write_unaligned((word ^ (mask as u64 * 0x0101010101010101)).to_be());
                last = (bytes & 127) as u32;
                width = 7;
                at += 7;
                pos += 8;
                continue;
            }
        }
        let (data, wide) = entry(input, &mut pos, count, &mut valid);
        #[cfg(branchless)]
        {
            out.add(at).write(((data >> 7) ^ mask) as u8);
            at += wide as usize;
        }
        #[cfg(not(branchless))]
        if wide {
            out.add(at).write(((data >> 7) ^ mask) as u8);
            at += 1;
        }
        let mut carry = data & 127;
        macro_rules! step {
            ($j:literal) => {{
                let (data, wide) = entry(input, &mut pos, count, &mut valid);
                out.add(at)
                    .write((((carry << $j) | (data >> (15 - $j))) ^ mask) as u8);
                at += 1;
                #[cfg(branchless)]
                {
                    out.add(at).write(((data >> (7 - $j)) ^ mask) as u8);
                    at += wide as usize;
                }
                #[cfg(not(branchless))]
                if wide {
                    out.add(at).write(((data >> (7 - $j)) ^ mask) as u8);
                    at += 1;
                }
                carry = data & ((1 << (7 - $j)) - 1);
                if $j == 7 {
                    last = data;
                    width = if wide { 15 } else { 7 };
                }
            }};
        }
        step!(1);
        step!(2);
        step!(3);
        step!(4);
        step!(5);
        step!(6);
        step!(7);
        let _ = carry;
    }
    let (mut q, mut bits) = (0u32, 0u32);
    #[cfg(high)]
    while pos + 2 <= count && at + 2 <= expected {
        let (data, wide) = entry(input, &mut pos, count, &mut valid);
        width = if wide { 15 } else { 7 };
        last = data;
        let data = if wide { data } else { data & 127 };
        q |= data << (32 - bits - width);
        out.add(at)
            .cast::<u16>()
            .write_unaligned(((q >> 16) as u16).to_be() ^ (mask as u16 * 257));
        let total = bits + width;
        let advance = total >> 3;
        at += advance as usize;
        q <<= advance * 8;
        bits = total & 7;
    }
    #[cfg(high)]
    {
        q >>= 32 - bits;
    }
    while pos < count {
        let (data, wide) = entry(input, &mut pos, count, &mut valid);
        width = if wide { 15 } else { 7 };
        last = data;
        q = (q << width) | (if wide { data } else { data & 127 });
        bits += width;
        if bits >= 8 {
            bits -= 8;
            store(out, &mut at, q >> bits, mask, expected);
            if bits >= 8 {
                bits -= 8;
                store(out, &mut at, q >> bits, mask, expected);
            }
        }
    }
    if valid >= 0 {
        return 1;
    }
    let total = at * 8 + bits as usize;
    if total < expected * 8 {
        return 2;
    }
    let padding = total - expected * 8;
    if (count > 0 && padding >= width as usize) || (last & ((1 << padding) - 1) != 0) {
        return 4;
    }
    0
}
