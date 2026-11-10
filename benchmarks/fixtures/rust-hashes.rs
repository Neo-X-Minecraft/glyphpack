//! Benchmark-only ABI around the same Rust hash source as production. This
//! module is never embedded in a distribution. No allocator or host imports.
#![no_std]
use core::cell::UnsafeCell;
#[allow(dead_code)]
#[path = "../../src/hash.rs"]
mod hash;
struct Shared<T>(UnsafeCell<T>);
// No imports, threads or callbacks: each instance is synchronously owned.
unsafe impl<T> Sync for Shared<T> {}
static BUFFER: Shared<(usize, usize)> = Shared(UnsafeCell::new((0, 0)));
static DIGEST: Shared<[u8; 32]> = Shared(UnsafeCell::new([0; 32]));
extern "C" {
    static __heap_base: u8;
}
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}
#[no_mangle]
pub extern "C" fn reserve(length: usize) -> usize {
    unsafe {
        let state = &mut *BUFFER.0.get();
        if state.0 == 0 {
            state.0 = core::ptr::addr_of!(__heap_base) as usize;
        }
        if length > state.1 {
            let Some(end) = state
                .0
                .checked_add(length)
                .and_then(|v| v.checked_add(65535))
            else {
                return 0;
            };
            let pages = end / 65536;
            let current = core::arch::wasm32::memory_size::<0>();
            if pages > current
                && core::arch::wasm32::memory_grow::<0>(pages - current) == usize::MAX
            {
                return 0;
            }
            state.1 = length;
        }
        state.0
    }
}
#[no_mangle]
pub extern "C" fn blake3(length: usize) -> usize {
    unsafe {
        let state = &*BUFFER.0.get();
        if length > state.1 {
            return 0;
        }
        let bytes = core::slice::from_raw_parts(state.0 as *const u8, length);
        *DIGEST.0.get() = hash::blake3(bytes);
        DIGEST.0.get().cast::<u8>() as usize
    }
}
#[no_mangle]
pub extern "C" fn xxhash32(length: usize) -> u32 {
    unsafe {
        let state = &*BUFFER.0.get();
        if length > state.1 {
            return 0;
        }
        hash::xxhash32(core::slice::from_raw_parts(state.0 as *const u8, length))
    }
}
