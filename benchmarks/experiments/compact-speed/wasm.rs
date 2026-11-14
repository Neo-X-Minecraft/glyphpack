// 0BSD, NeoX. no_std integer/float-quotient ANS candidates.
#![no_std]
const Q: u64 = 1 << 23;
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}
unsafe fn run<const SHIFT: u32, const FLOAT: bool>(
    input: u32,
    count: u32,
    output: u32,
    size: u32,
    final_state: f64,
) -> u32 {
    let mut state = final_state as u64;
    let mut at = size as usize;
    let input = input as *const u16;
    let output = output as *mut u8;
    for i in (0..count as usize).rev() {
        let cp = u32::from(unsafe { *input.add(i) });
        let (f, c) = if cp < 128 {
            if cp == 0 || cp == 13 {
                return 1;
            }
            let d = cp - 1 - u32::from(cp > 13);
            if d < 110 {
                (58821u64, u64::from(d) * 58821)
            } else {
                (58820, 6470310 + u64::from(d - 110) * 58820)
            }
        } else if cp < 2048 {
            (413, 7411430 + u64::from(cp - 128) * 413)
        } else {
            if (0xd800..0xe000).contains(&cp) || (0xfdd0..=0xfdef).contains(&cp) || cp >= 65534 {
                return 1;
            }
            let d =
                cp - 2048 - if cp >= 57344 { 2048 } else { 0 } - if cp >= 65008 { 32 } else { 0 };
            (3, 8204390 + u64::from(d) * 3)
        };
        let limit = f << (SHIFT - 23 + 8);
        while state >= limit {
            if at == 0 {
                return 2;
            }
            at -= 1;
            unsafe {
                *output.add(at) = state as u8;
            }
            state >>= 8;
        }
        let q = if FLOAT {
            (unsafe { (state as f64 / f as f64).to_int_unchecked::<u32>() }) as u64
        } else {
            state / f
        };
        state = q * Q + state - q * f + c;
    }
    if at != 0 || state != 1u64 << SHIFT {
        3
    } else {
        0
    }
}
#[no_mangle]
pub unsafe extern "C" fn decode_23(p: u32, n: u32, o: u32, s: u32, x: f64) -> u32 {
    unsafe { run::<23, false>(p, n, o, s, x) }
}
#[no_mangle]
pub unsafe extern "C" fn decode_30(p: u32, n: u32, o: u32, s: u32, x: f64) -> u32 {
    unsafe { run::<30, false>(p, n, o, s, x) }
}
#[no_mangle]
pub unsafe extern "C" fn decode_30_float(p: u32, n: u32, o: u32, s: u32, x: f64) -> u32 {
    unsafe { run::<30, true>(p, n, o, s, x) }
}
unsafe fn step<const F: u32, const C: u64>(
    mut x: u64,
    d: u32,
    out: *mut u8,
    at: &mut usize,
) -> Option<u64> {
    while x >= u64::from(F) << 15 {
        if *at == 0 {
            return None;
        }
        *at -= 1;
        unsafe {
            *out.add(*at) = x as u8;
        }
        x >>= 8;
    }
    let v = x as u32;
    let q = v / F;
    Some((u64::from(q) << 23) + u64::from(v - q * F) + C + u64::from(d) * u64::from(F))
}
#[no_mangle]
pub unsafe extern "C" fn decode_30_const(p: u32, n: u32, o: u32, s: u32, z: f64) -> u32 {
    let mut x = z as u64;
    let mut at = s as usize;
    let input = p as *const u16;
    let out = o as *mut u8;
    for i in (0..n as usize).rev() {
        let c = u32::from(unsafe { *input.add(i) });
        let next = if c < 128 {
            if c == 0 || c == 13 {
                return 1;
            }
            let d = c - 1 - u32::from(c > 13);
            if d < 110 {
                unsafe { step::<58821, 0>(x, d, out, &mut at) }
            } else {
                unsafe { step::<58820, 6470310>(x, d - 110, out, &mut at) }
            }
        } else if c < 2048 {
            unsafe { step::<413, 7411430>(x, c - 128, out, &mut at) }
        } else {
            if (0xd800..0xe000).contains(&c) || (0xfdd0..=0xfdef).contains(&c) || c >= 65534 {
                return 1;
            }
            let d = c - 2048 - if c >= 57344 { 2048 } else { 0 } - if c >= 65008 { 32 } else { 0 };
            unsafe { step::<3, 8204390>(x, d, out, &mut at) }
        };
        let Some(v) = next else {
            return 2;
        };
        x = v;
    }
    if at != 0 || x != 1 << 30 {
        3
    } else {
        0
    }
}
unsafe fn run32(p: u32, n: u32, o: u32, s: u32, z: f64) -> u32 {
    let mut state = z as u64;
    let mut at = s as usize;
    let input = p as *const u16;
    let out = o as *mut u8;
    for i in (0..n as usize).rev() {
        let cp = u32::from(unsafe { *input.add(i) });
        let (f, c) = if cp < 128 {
            if cp == 0 || cp == 13 {
                return 1;
            }
            let d = cp - 1 - u32::from(cp > 13);
            if d < 110 {
                (58821u32, d * 58821)
            } else {
                (58820, 6470310 + (d - 110) * 58820)
            }
        } else if cp < 2048 {
            (413, 7411430 + (cp - 128) * 413)
        } else {
            if (0xd800..0xe000).contains(&cp) || (0xfdd0..=0xfdef).contains(&cp) || cp >= 65534 {
                return 1;
            }
            let d =
                cp - 2048 - if cp >= 57344 { 2048 } else { 0 } - if cp >= 65008 { 32 } else { 0 };
            (3, 8204390 + d * 3)
        };
        let limit = u64::from(f) << 15;
        while state >= limit {
            if at == 0 {
                return 2;
            }
            at -= 1;
            unsafe {
                *out.add(at) = state as u8;
            }
            state >>= 8;
        }
        let v = state as u32;
        let q = v / f;
        state = (u64::from(q) << 23) + u64::from(v - q * f + c);
    }
    if at != 0 || state != 1 << 30 {
        3
    } else {
        0
    }
}
#[no_mangle]
pub unsafe extern "C" fn decode_30_u32(p: u32, n: u32, o: u32, s: u32, z: f64) -> u32 {
    unsafe { run32(p, n, o, s, z) }
}
