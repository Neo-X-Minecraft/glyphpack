/* 0BSD, NeoX. Candidate end-to-end UTF-16 staging and owned output. */
export function host(wasm, name, copy = 0) {
  const memory = new WebAssembly.Memory({ initial: 2 });
  const api = new WebAssembly.Instance(new WebAssembly.Module(wasm), {
    env: { memory },
  }).exports;
  let capacity = 0,
    output = 65536;
  return (text, state, size) => {
    if (text.length > capacity) {
      capacity = 2 ** Math.ceil(Math.log2(text.length));
      output = 65536 + capacity * 2;
    }
    const pages = Math.ceil((output + size) / 65536);
    if (pages > memory.buffer.byteLength / 65536)
      memory.grow(pages - memory.buffer.byteLength / 65536);
    const view = new Uint16Array(memory.buffer, 65536, text.length);
    let i = 0;
    if (copy === 1)
      for (; i + 8 <= text.length; i += 8) {
        view[i] = text.charCodeAt(i);
        view[i + 1] = text.charCodeAt(i + 1);
        view[i + 2] = text.charCodeAt(i + 2);
        view[i + 3] = text.charCodeAt(i + 3);
        view[i + 4] = text.charCodeAt(i + 4);
        view[i + 5] = text.charCodeAt(i + 5);
        view[i + 6] = text.charCodeAt(i + 6);
        view[i + 7] = text.charCodeAt(i + 7);
      }
    for (; i < text.length; i++) view[i] = text.charCodeAt(i);
    const code = api[name](65536, text.length, output, size, state);
    if (code) throw Error("Wasm status " + code);
    return new Uint8Array(memory.buffer, output, size).slice();
  };
}
