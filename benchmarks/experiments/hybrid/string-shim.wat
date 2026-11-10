;; Link this small reference-types shim to the Rust kernel. Native builtins are
;; enabled by the ESM loader on modern V8. Chrome 109 uses the memory reader and
;; never calls its provided charCodeAt polyfill. No Wasm GC types are required.
(module
  (import "kernel" "decode_direct" (func $decode (param i32 i32 i32 i32) (result i32)))
  (import "wasm:js-string" "charCodeAt" (func $character (param externref i32) (result i32)))
  (global $text (mut externref) (ref.null extern))
  (func (export "char_code_at") (param $index i32) (result i32)
    (call $character (global.get $text) (local.get $index)))
  (func (export "decode_string")
    (param $source externref) (param $length i32) (param $format i32)
    (param $data i32) (param $memory i32) (result i32)
    (local $status i32)
    (global.set $text (local.get $source))
    (local.set $status (call $decode (local.get $length) (local.get $format) (local.get $data) (local.get $memory)))
    ;; Release the source before the host handles success or an error status.
    (global.set $text (ref.null extern))
    (local.get $status)))
