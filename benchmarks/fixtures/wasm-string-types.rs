//! 0BSD, NeoX. Change opaque i64 handles and locals to Wasm external references.
//! This kernel uses i64 only for the string handle, never for arithmetic. That
//! separate register class prevents LLVM reuse of the handle as an i32 local.
//! Known import/export signatures change; builtin cast returns a nonnull ref.
//! Instructions, indices and numeric constants are never rewritten.
use std::{env, fs};
fn leb(data: &[u8], pos: &mut usize) -> usize {
    let (mut n, mut s) = (0, 0);
    loop {
        let b = data[*pos];
        *pos += 1;
        n |= ((b & 127) as usize) << s;
        if b & 128 == 0 {
            return n;
        }
        s += 7;
        assert!(s < 35);
    }
}
fn write_leb(out: &mut Vec<u8>, mut n: usize) {
    loop {
        let b = (n & 127) as u8;
        n >>= 7;
        out.push(b | if n > 0 { 128 } else { 0 });
        if n == 0 {
            break;
        }
    }
}
fn main() {
    let a: Vec<_> = env::args().collect();
    let data = fs::read(&a[1]).unwrap();
    assert_eq!(&data[..8], b"\0asm\x01\0\0\0");
    let (mut pos, mut changed) = (8, 0);
    let mut out = data[..8].to_vec();
    while pos < data.len() {
        let id = data[pos];
        pos += 1;
        let len = leb(&data, &mut pos);
        let end = pos + len;
        let mut section = data[pos..end].to_vec();
        let mut p = 0;
        if id == 1 {
            let count = leb(&section, &mut p);
            let mut types = section[..p].to_vec();
            for _ in 0..count {
                assert_eq!(section[p], 0x60);
                p += 1;
                let n = leb(&section, &mut p);
                let mut params = section[p..p + n].to_vec();
                p += n;
                let r = leb(&section, &mut p);
                let mut result = section[p..p + r].to_vec();
                p += r;
                if [1, 2, 6].contains(&n) && r == 1 && params[0] == 0x7e {
                    assert!(params[1..].iter().all(|&c| c == 0x7f));
                    params[0] = 0x6f;
                    if result[0] == 0x7e {
                        assert_eq!(n, 1);
                        result = vec![0x64, 0x6f];
                    } else {
                        assert_eq!(result[0], 0x7f);
                    }
                    changed += 1;
                }
                types.push(0x60);
                write_leb(&mut types, n);
                types.extend(params);
                write_leb(&mut types, r);
                types.extend(result);
            }
            assert_eq!(p, section.len());
            section = types;
        } else if id == 10 {
            let count = leb(&section, &mut p);
            for _ in 0..count {
                let n = leb(&section, &mut p);
                let body_end = p + n;
                let groups = leb(&section, &mut p);
                for _ in 0..groups {
                    let _n = leb(&section, &mut p);
                    if section[p] == 0x7e {
                        section[p] = 0x6f;
                    }
                    p += 1;
                }
                p = body_end;
            }
            assert_eq!(p, section.len());
        }
        out.push(id);
        write_leb(&mut out, section.len());
        out.extend(section);
        pos = end;
    }
    assert!((2..=4).contains(&changed));
    fs::write(&a[2], out).unwrap();
}
