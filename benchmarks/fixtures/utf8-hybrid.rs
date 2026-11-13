//! 0BSD, NeoX. Small body-only Wasm kernels for the JS/Wasm transfer search.
//! JS owns headers/alphabet construction; the kernel accepts a copied table or
//! pretranslated words. Compile-time cfgs retain only one input and loop type.
//! Memory is unshared, exports are synchronous, and there are no callbacks;
//! this makes the UnsafeCell state nonreentrant. This is research, not an ABI.
#![no_std]
use core::cell::UnsafeCell;

struct Shared<T>(UnsafeCell<T>);
unsafe impl<T> Sync for Shared<T> {}
static STATE: Shared<State> = Shared(UnsafeCell::new(State {
    cap: 0,
    slots: 0,
    out: 0,
    limit: 0,
    seen: 0,
    q: 0,
    bits: 0,
    at: 0,
    last: 0,
    tail: 0,
    mask: 0,
}));
#[cfg(any(input_utf8, input_utf16))]
static TABLE: Shared<[u32; 2048]> = Shared(UnsafeCell::new([0; 2048]));

struct State {
    cap: usize,
    slots: usize,
    out: usize,
    limit: usize,
    seen: usize,
    q: u32,
    bits: u32,
    at: usize,
    last: u32,
    tail: u32,
    mask: u8,
}
extern "C" {
    static __heap_base: u8;
}
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(any(input_utf8, input_utf16))]
#[no_mangle]
pub extern "C" fn table_ptr() -> usize {
    TABLE.0.get() as usize
}

// Reserve enough space for malformed excess bodies too. Every valid input
// symbol produces <=2 bytes. Extra sixteen bytes make speculative stores safe;
// output is copied to a fresh exact-size JS array only after finish succeeds.
#[no_mangle]
pub extern "C" fn begin(chars: usize, slots: usize, mask: u32) -> usize {
    if chars > (1 << 27) || slots > (1 << 27) {
        return 0;
    }
    let cap = chars.max(1).next_power_of_two();
    let slots = if slots == 0 { cap } else { slots };
    let stride = if cfg!(input_words) { 4 } else { 2 };
    let base = core::ptr::addr_of!(__heap_base) as usize;
    let out = base + slots * stride;
    let pages = (out + 2 * cap + 16).div_ceil(65536);
    let current = core::arch::wasm32::memory_size::<0>();
    if pages > current && core::arch::wasm32::memory_grow::<0>(pages - current) == usize::MAX {
        return 0;
    }
    let limit = chars * if cfg!(input_utf8) { 2 } else { 1 };
    unsafe {
        *STATE.0.get() = State {
            cap,
            slots,
            out,
            limit,
            seen: 0,
            q: 0,
            bits: 0,
            at: 0,
            last: 0,
            tail: 0,
            mask: mask as u8,
        };
    }
    base
}
#[no_mangle]
pub extern "C" fn output_ptr() -> usize {
    unsafe { (*STATE.0.get()).out }
}
#[no_mangle]
pub extern "C" fn input_capacity() -> usize {
    unsafe { (*STATE.0.get()).slots }
}

// Read one symbol. UTF-8 comes from native TextEncoder.encodeInto, but every
// leading/tail byte is still checked. All table indices are proven <2048.
#[inline(always)]
unsafe fn next(input: *const u8, pos: &mut usize, len: usize) -> u32 {
    if *pos >= len {
        return 0;
    }
    #[cfg(input_utf8)]
    {
        let first = *input.add(*pos);
        *pos += 1;
        let cp = if first < 128 {
            first as usize
        } else {
            if !(0xc2..=0xdf).contains(&first) || *pos == len {
                return 0;
            }
            let second = *input.add(*pos);
            *pos += 1;
            if second & 0xc0 != 0x80 {
                return 0;
            }
            ((first as usize & 31) << 6) | (second as usize & 63)
        };
        (*TABLE.0.get())[cp]
    }
    #[cfg(input_utf16)]
    {
        let cp = input.cast::<u16>().add(*pos).read() as usize;
        *pos += 1;
        if cp >= 2048 {
            0
        } else {
            (*TABLE.0.get())[cp]
        }
    }
    #[cfg(input_words)]
    {
        let entry = input.cast::<u32>().add(*pos).read();
        *pos += 1;
        entry
    }
    #[cfg(input_tokens)]
    {
        let token = input.cast::<u16>().add(*pos).read() as u32;
        *pos += 1;
        if token == 0 {
            return 0;
        }
        let width = 31 - token.leading_zeros();
        (width << 16) | (token ^ (1 << width)) | 0x80000000
    }
}

#[no_mangle]
pub unsafe extern "C" fn push(len: usize) -> u32 {
    let state = &mut *STATE.0.get();
    let max = if cfg!(input_utf8) {
        2 * state.slots
    } else {
        state.slots
    };
    if len > max || len > state.limit - state.seen {
        return 2;
    }
    state.seen += len;
    let input = core::ptr::addr_of!(__heap_base);
    let output = state.out as *mut u8;
    let (mut pos, mut q, mut bits, mut at, mut last, mut tail) = (
        0usize, state.q, state.bits, state.at, state.last, state.tail,
    );
    while pos < len {
        #[cfg(block8)]
        if pos + 8 <= len {
            // Inspect eight symbols without committing. A wide symbol restores
            // the original position so the scalar path consumes exactly one.
            let saved = pos;
            let mut e = [0u32; 8];
            let mut ascii = true;
            for value in &mut e {
                *value = next(input, &mut pos, len);
                ascii &= ((*value >> 16) & 15) == 7;
            }
            if ascii {
                let word = ((q & ((1 << bits) - 1)) as u64) << 56
                    | ((e[0] & 127) as u64) << 49
                    | ((e[1] & 127) as u64) << 42
                    | ((e[2] & 127) as u64) << 35
                    | ((e[3] & 127) as u64) << 28
                    | ((e[4] & 127) as u64) << 21
                    | ((e[5] & 127) as u64) << 14
                    | ((e[6] & 127) as u64) << 7
                    | (e[7] & 127) as u64;
                // Eight 7-bit symbols emit seven bytes and preserve bit count.
                output.add(at).cast::<u64>().write_unaligned(
                    (((word >> bits) << 8) ^ (state.mask as u64 * 0x0101010101010101)).to_be(),
                );
                tail = word as u32;
                q = word as u32 & ((1 << bits) - 1);
                last = 7;
                at += 7;
                continue;
            }
            pos = saved;
        }
        let entry = next(input, &mut pos, len);
        if entry == 0 {
            return 1;
        }
        let width = (entry >> 16) & 15;
        if width != 7 && width != 14 && width != 15 {
            return 1;
        }
        let data = entry & 32767;
        last = width;
        #[cfg(queue_high)]
        {
            q |= data << (32 - bits - width);
            let total = bits + width;
            tail = q >> (32 - total);
            output.add(at).write((q >> 24) as u8 ^ state.mask);
            if width != 7 {
                output.add(at + 1).write((q >> 16) as u8 ^ state.mask);
            }
            let advance = total >> 3;
            at += advance as usize;
            q <<= advance * 8;
            bits = total & 7;
        }
        #[cfg(not(queue_high))]
        {
            q = (q << width) | data;
            tail = q;
            bits += width;
            if bits >= 8 {
                bits -= 8;
                output.add(at).write((q >> bits) as u8 ^ state.mask);
                at += 1;
                if bits >= 8 {
                    bits -= 8;
                    output.add(at).write((q >> bits) as u8 ^ state.mask);
                    at += 1;
                }
            }
        }
    }
    state.q = q;
    state.bits = bits;
    state.at = at;
    state.last = last;
    state.tail = tail;
    0
}
#[no_mangle]
pub extern "C" fn finish(expected: usize) -> u32 {
    let s = unsafe { &*STATE.0.get() };
    if expected > 2 * s.cap || s.at * 8 + (s.bits as usize) < expected * 8 {
        return 2;
    }
    let padding = s.at * 8 + s.bits as usize - expected * 8;
    if (s.last != 0 && padding >= s.last as usize) || (s.tail & ((1 << padding) - 1)) != 0 {
        return 4;
    }
    0
}
