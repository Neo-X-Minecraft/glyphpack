//! 0BSD, NeoX. Stateless kernels using JS-owned, unshared imported memory.
//! The wrapper proves input/output arena bounds before entering. Alphabet
//! tables are trusted construction output; zero entries still reject symbols.
//! Linear stack fits below 32 KiB; tables start there, input begins above tables.
#![no_std]
#[cfg(input_jsstring)]
#[link(wasm_import_module = "wasm:js-string")]
extern "C" {
    #[link_name = "charCodeAt"]
    fn char_code_at(text: u64, index: u32) -> u32;
    #[cfg(string_length)]
    #[link_name = "length"]
    fn string_len(text: u64) -> u32;
    #[cfg(string_cast)]
    #[link_name = "cast"]
    fn string_cast_value(text: u64) -> u64;
}
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
// Cfgs intentionally use different subsets of these reservoir registers.
#[allow(unused_mut, unused_variables)]
pub unsafe extern "C" fn decode(
    #[cfg(not(input_jsstring))] input: usize,
    #[cfg(input_jsstring)] input: u64,
    #[cfg(input_jsstring)] start: u32,
    count: usize,
    output: usize,
    expected: usize,
    mask: u32,
) -> u32 {
    #[cfg(all(input_jsstring, string_cast))]
    let input = string_cast_value(input);
    #[cfg(all(input_jsstring, string_length))]
    let count = (string_len(input) - start) as usize;
    let table = 32768 as *const u32;
    let out = output as *mut u8;
    let (mut q, mut bits, mut at, mut pos, mut last, mut tail) =
        (0u32, 0u32, 0usize, 0usize, 0u32, 0u32);
    #[cfg(fsm)]
    let mut state = 1usize;
    while pos < count {
        #[cfg(block8)]
        if pos + 8 <= count {
            let mut codes = [0u32; 8];
            #[cfg(input_utf16)]
            let ascii = {
                let p = (input as *const u16)
                    .add(pos)
                    .cast::<u64>()
                    .read_unaligned();
                let r = (input as *const u16)
                    .add(pos + 4)
                    .cast::<u64>()
                    .read_unaligned();
                if (p | r) & 0xff80ff80ff80ff80 == 0 {
                    for i in 0..4 {
                        codes[i] = ((p >> (16 * i)) & 127) as u32;
                        codes[i + 4] = ((r >> (16 * i)) & 127) as u32;
                    }
                    let mut valid = u32::MAX;
                    for &c in &codes {
                        valid &= table.add(c as usize).read();
                    }
                    if valid & 0x80000000 == 0 {
                        return 1;
                    }
                    true
                } else {
                    false
                }
            };
            #[cfg(input_words)]
            let ascii = {
                let p = (input as *const u32)
                    .add(pos)
                    .cast::<u64>()
                    .read_unaligned();
                let r = (input as *const u32)
                    .add(pos + 2)
                    .cast::<u64>()
                    .read_unaligned();
                let s = (input as *const u32)
                    .add(pos + 4)
                    .cast::<u64>()
                    .read_unaligned();
                let t = (input as *const u32)
                    .add(pos + 6)
                    .cast::<u64>()
                    .read_unaligned();
                if (p | r | s | t) & 0x0008000000080000 == 0 {
                    if (p & r & s & t) & 0x8000000080000000 != 0x8000000080000000 {
                        return 1;
                    }
                    for (i, &v) in [p, r, s, t].iter().enumerate() {
                        codes[2 * i] = (v & 127) as u32;
                        codes[2 * i + 1] = ((v >> 32) & 127) as u32;
                    }
                    true
                } else {
                    false
                }
            };
            if ascii {
                let word = ((q & ((1 << bits) - 1)) as u64) << 56
                    | (codes[0] as u64) << 49
                    | (codes[1] as u64) << 42
                    | (codes[2] as u64) << 35
                    | (codes[3] as u64) << 28
                    | (codes[4] as u64) << 21
                    | (codes[5] as u64) << 14
                    | (codes[6] as u64) << 7
                    | codes[7] as u64;
                out.add(at).cast::<u64>().write_unaligned(
                    (((word >> bits) << 8) ^ (mask as u64 * 0x0101010101010101)).to_be(),
                );
                q = word as u32 & ((1 << bits) - 1);
                tail = word as u32;
                last = 7;
                at += 7;
                pos += 8;
                continue;
            }
        }
        #[cfg(fsm)]
        {
            let cp = (input as *const u16).add(pos).read() as usize;
            if cp >= 2048 {
                return 1;
            }
            let e = table.add(state * 2048 + cp).read();
            if e == 0 {
                return 1;
            }
            out.add(at)
                .cast::<u16>()
                .write_unaligned((e as u16) ^ (mask as u16 * 257));
            at += ((e >> 24) & 3) as usize;
            state = ((e >> 16) & 255) as usize;
            last = (e >> 26) & 15;
            pos += 1;
        }
        #[cfg(not(fsm))]
        {
            #[cfg(input_utf8)]
            let e = {
                let first = (input as *const u8).add(pos).read();
                pos += 1;
                let cp = if first < 128 {
                    first as usize
                } else {
                    if !(0xc2..=0xdf).contains(&first) || pos == count {
                        return 1;
                    }
                    let second = (input as *const u8).add(pos).read();
                    pos += 1;
                    if second & 0xc0 != 0x80 {
                        return 1;
                    }
                    ((first as usize & 31) << 6) | (second as usize & 63)
                };
                table.add(cp).read()
            };

            #[cfg(input_utf16)]
            let e = {
                let cp = (input as *const u16).add(pos).read() as usize;
                if cp >= 2048 {
                    return 1;
                }
                table.add(cp).read()
            };
            #[cfg(input_words)]
            let e = (input as *const u32).add(pos).read();
            #[cfg(input_jsstring)]
            let e = {
                let cp = char_code_at(input, start + pos as u32) as usize;
                if cp >= 2048 {
                    return 1;
                }
                table.add(cp).read()
            };
            if e == 0 {
                return 1;
            }
            let width = (e >> 16) & 15;
            let data = e & 32767;
            last = width;
            #[cfg(queue_high)]
            {
                q |= data << (32 - bits - width);
                let total = bits + width;
                tail = q >> (32 - total);
                out.add(at).write((q >> 24) as u8 ^ mask as u8);
                if width != 7 {
                    out.add(at + 1).write((q >> 16) as u8 ^ mask as u8);
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
                    out.add(at).write((q >> bits) as u8 ^ mask as u8);
                    at += 1;
                    if bits >= 8 {
                        bits -= 8;
                        out.add(at).write((q >> bits) as u8 ^ mask as u8);
                        at += 1;
                    }
                }
            }
            #[cfg(not(input_utf8))]
            {
                pos += 1;
            }
        }
    }
    #[cfg(fsm)]
    {
        bits = 31 - (state as u32).leading_zeros();
    }
    if at * 8 + (bits as usize) < expected * 8 {
        return 2;
    }
    let padding = at * 8 + bits as usize - expected * 8;
    if count > 0 && padding >= last as usize {
        return 4;
    }
    #[cfg(fsm)]
    {
        if (state as u32 & ((1 << bits) - 1)) != 0
            || (at > expected && (*out.add(expected) ^ mask as u8) != 0)
        {
            return 4;
        }
    }
    #[cfg(not(fsm))]
    if tail & ((1 << padding) - 1) != 0 {
        return 4;
    }
    0
}
