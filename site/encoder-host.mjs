// Host the Rust encoder without converting each UTF-16 unit through JS calls.
// Wasm memory is little-endian. The alphabet excludes surrogates; ignoreBOM
// preserves every leading unit rather than treating one as a stream marker.
const utf16 = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true });
const utf8 = new TextDecoder();

// Integrity modes: 0=none, 1=XXH32, 2=BLAKE3. Defaults match the Rust encoder.
export function encode(api, bytes, mode = 2, exact = true) {
  if (mode !== 0 && mode !== 1 && mode !== 2)
    throw Error("Unsupported encoder integrity mode");
  const pointer = api.input_ptr(bytes.length);
  new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
  if (api.encode(mode, +exact)) {
    throw Error(
      utf8.decode(
        new Uint8Array(api.memory.buffer, api.error_ptr(), api.error_len()),
      ) || "Unable to encode",
    );
  }
  // Encoding may grow memory. Obtain the buffer after the call; native decoding
  // produces an owned JS string that remains valid when Wasm reuses its output.
  return utf16.decode(
    new Uint8Array(api.memory.buffer, api.output_ptr(), api.output_len() * 2),
  );
}
