// All bit packing and decoding stays in Rust/Wasm. This worker owns the engines
// and keeps whole-input encoding and warmed timing loops off the main thread.
import { binary } from "./lib/full.min.mjs";
import { api } from "./encoder.mjs";
const modes = { none: 0, fast: 1, secure: 2 },
  limit = 16 * 1024 * 1024;
function encode(bytes, mode, exact) {
  if (bytes.length > limit)
    throw Error(
      "The playground accepts files up to 16 MiB. Use the Rust CLI for larger files.",
    );
  const pointer = api.input_ptr(bytes.length);
  new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
  if (api.encode(modes[mode], +exact))
    throw Error(
      new TextDecoder().decode(
        new Uint8Array(api.memory.buffer, api.error_ptr(), api.error_len()),
      ) || "Unable to encode",
    );
  const view = new Uint16Array(
    api.memory.buffer,
    api.output_ptr(),
    api.output_len(),
  );
  let text = "";
  for (let i = 0; i < view.length; i += 8192)
    text += String.fromCharCode(...view.subarray(i, i + 8192));
  return text;
}
async function transform(bytes, kind) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(
      kind === "gzip"
        ? new CompressionStream("gzip")
        : new DecompressionStream("gzip"),
    );
  const reader = stream.getReader(),
    chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw Error("Expanded data exceeds the playground’s 16 MiB limit.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
self.onmessage = async ({ data: { id, action, ...data } }) => {
  try {
    let result;
    if (action === "encode") {
      let bytes = new Uint8Array(data.bytes);
      if (data.gzip) bytes = await transform(bytes, "gzip");
      const start = performance.now(),
        payload = encode(bytes, data.mode, data.exact),
        encodeMs = performance.now() - start;
      const decoded = binary(payload, { verifyData: data.mode });
      result = { payload, bytes: decoded, encodeMs };
    } else if (action === "decode") {
      const start = performance.now(),
        bytes = binary(data.payload, data.options);
      result = { bytes, decodeMs: performance.now() - start };
    } else if (action === "inflate")
      result = {
        bytes: await transform(new Uint8Array(data.bytes), "inflate"),
      };
    else if (action === "benchmark") {
      const rows = [],
        length = binary(data.payload, data.options).length,
        batch = length < 4096 ? 128 : length < 65536 ? 16 : 1;
      for (const memoryHeavy of [false, true]) {
        const options = { ...data.options, memoryHeavy };
        binary(data.payload, options);
        rows.push({ memoryHeavy, options, times: [] });
      }
      let sink = 0;
      for (let round = -3; round < 7; round++)
        for (let j = 0; j < 2; j++) {
          const row = rows[(j + round + 4) % 2],
            start = performance.now();
          for (let n = 0; n < batch; n++) {
            const out = binary(data.payload, row.options);
            sink ^= out[0] || 0;
          }
          if (round >= 0) row.times.push((performance.now() - start) / batch);
        }
      result = {
        rows: rows.map(({ memoryHeavy, times }) => ({
          memoryHeavy,
          medianMs: times.sort((a, b) => a - b)[3],
        })),
        batch,
        bytes: length,
        sink,
      };
    } else throw Error("Unknown action");
    self.postMessage(
      { id, result },
      result.bytes instanceof Uint8Array ? [result.bytes.buffer] : [],
    );
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
self.postMessage({ ready: true });
