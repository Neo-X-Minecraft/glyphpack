// The page only manages local files and views. Rust/Wasm work runs in the worker.
const $ = (id) => document.getElementById(id),
  utf8 = new TextEncoder(),
  limit = 16 * 1024 * 1024;
const state = {
  ready: false,
  busy: false,
  samples: [],
  sample: null,
  file: null,
  payload: "",
  goodPayload: "",
  bytes: null,
  meta: { name: "text.txt", mime: "text/plain", gzip: false },
  outputMeta: null,
  imageUrl: null,
};
const worker = new Worker(new URL("./codec-worker.mjs", import.meta.url), {
    type: "module",
  }),
  pending = new Map();
let sequence = 0;
let readyResolve, readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
worker.onmessage = ({ data }) => {
  if (data.ready) {
    state.ready = true;
    $("engine-status").textContent =
      "Local engines ready · files never uploaded";
    $("engine-dot").className = "dot ready";
    readyResolve();
    buttons();
    return;
  }
  const job = pending.get(data.id);
  if (!job) return;
  pending.delete(data.id);
  data.error ? job.reject(Error(data.error)) : job.resolve(data.result);
};
worker.onerror = (event) => {
  const error = Error(
    event.message || "Unable to load the local engines. Try a current browser.",
  );
  readyReject(error);
  for (const job of pending.values()) job.reject(error);
  pending.clear();
  status(error.message, true);
  $("engine-dot").className = "dot error";
  $("engine-status").textContent = "Engine unavailable";
};
function rpc(action, data = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, ...data });
  });
}
function options() {
  return {
    verifyFormat: $("format").checked,
    verifyData: $("integrity").value,
    memoryHeavy: $("memory").checked,
  };
}
function status(text, error = false) {
  $("status").textContent = text;
  $("status").className = error ? "error" : "";
}
function buttons() {
  const locked = !state.ready || state.busy;
  for (const id of ["encode", "decode", "run-checks"]) $(id).disabled = locked;
  for (const id of [
    "download-bytes",
    "download-payload",
    "download-html",
    "recipe-html",
    "benchmark",
  ])
    $(id).disabled = locked || !state.bytes;
  $("copy-payload").disabled = locked || !state.payload;
  $("restore").disabled = locked || !state.goodPayload;
  $("inflate").disabled = locked;
  for (const id of [
    "file",
    "payload-file",
    "integrity",
    "format",
    "memory",
    "gzip",
    "effort",
  ])
    $(id).disabled = locked;
  $("input").readOnly = locked;
  $("payload").readOnly = locked || state.payload.length > 65536;
  for (const button of document.querySelectorAll("[data-example]"))
    button.disabled = locked;
}
async function action(label, fn) {
  if (state.busy) return;
  state.busy = true;
  buttons();
  status(label);
  try {
    await fn();
  } catch (error) {
    status(
      error.message +
        (state.bytes ? " Showing the last successful result." : ""),
      true,
    );
  } finally {
    state.busy = false;
    buttons();
  }
}
function size(n) {
  return n.toLocaleString() + " B";
}
function showPayload(text) {
  state.payload = text;
  const clipped = text.length > 65536;
  $("payload").value = clipped ? text.slice(0, 8192) : text;
  $("payload").readOnly = clipped;
  $("payload-note").textContent = clipped
    ? `${text.length.toLocaleString()} glyphs · preview only; download keeps all`
    : `${text.length.toLocaleString()} UTF-16 code units`;
}
function currentPayload() {
  return state.payload.length > 65536 ? state.payload : $("payload").value;
}
function displayName(name) {
  return name.replace(/\.gz$/i, "") || "decoded.bin";
}
function mediaType(name) {
  if (/\.(json|jsonl)$/i.test(name)) return "application/json";
  if (/\.svg$/i.test(name)) return "image/svg+xml";
  if (/\.(txt|csv|md|log)$/i.test(name)) return "text/plain";
  return "application/octet-stream";
}
function render() {
  if (!state.bytes) return;
  const bytes = state.bytes,
    meta = state.outputMeta,
    mode = $("view").value;
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = null;
  }
  $("image-preview").replaceChildren();
  $("image-preview").hidden = true;
  $("output").hidden = false;
  const hex = () => {
    const lines = [];
    for (let at = 0; at < Math.min(bytes.length, 512); at += 16) {
      const part = bytes.subarray(at, at + 16);
      lines.push(
        at.toString(16).padStart(6, "0") +
          "  " +
          Array.from(part, (b) => b.toString(16).padStart(2, "0"))
            .join(" ")
            .padEnd(47) +
          "  " +
          Array.from(part, (b) =>
            b >= 32 && b < 127 ? String.fromCharCode(b) : ".",
          ).join(""),
      );
    }
    return (
      lines.join("\n") +
      (bytes.length > 512 ? "\n… hex preview limited to 512 bytes" : "")
    );
  };
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, 65536),
    );
  } catch {
    text = "";
  }
  if (
    mode === "auto" &&
    /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(meta.mime)
  ) {
    const img = document.createElement("img");
    img.alt = "Decoded " + meta.name;
    state.imageUrl = URL.createObjectURL(
      new Blob([bytes], { type: meta.mime }),
    );
    img.src = state.imageUrl;
    $("image-preview").append(img);
    $("image-preview").hidden = false;
    $("output").hidden = true;
  } else {
    if (
      mode === "hex" ||
      (mode === "auto" && (bytes.includes(0) || (!text && bytes.length)))
    )
      text = hex();
    else if (!text && bytes.length)
      text = new TextDecoder().decode(bytes.subarray(0, 65536));
    else if (bytes.length < 65536 && /^\s*[\[{]/.test(text)) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}
    }
    $("output").textContent =
      text ||
      (bytes.length ? "[Binary data]" : "[Empty file — zero decoded bytes]");
  }
  $("output-title").textContent = meta.name;
  $("output-meta").textContent =
    size(bytes.length) +
    (bytes.length > 65536
      ? " · preview limited; downloads preserve every byte"
      : " · exact decoded bytes");
  $("inflate").hidden = !(bytes[0] === 31 && bytes[1] === 139);
}
// Keep the successful policy and metadata with the bytes, even after a failed edit.
function accept(result, meta, opts) {
  state.lastOptions = { ...opts };
  state.lastMeta = { ...meta };
  state.bytes = result.bytes;
  state.outputMeta = { ...meta };
  state.goodPayload = state.payload;
  render();
  $("stat-original").textContent = size(result.bytes.length);
  $("stat-packed").textContent = size(state.payload.length * 2);
  $("stat-utf8").textContent = size(utf8.encode(state.payload).length);
  $("stat-base64").textContent = size(4 * Math.ceil(result.bytes.length / 3));
  $("timing").textContent =
    result.decodeMs === undefined
      ? ""
      : result.decodeMs.toFixed(3) + " ms · one decode";
  const verification = {
    secure: "BLAKE3 verified",
    fast: "XXH32 verified",
    none: "Integrity verification skipped",
  }[opts.verifyData];
  status(`${verification} · ${size(result.bytes.length)} decoded.`);
  snippet();
}
function snippet() {
  const opts = options();
  $("current-code").textContent =
    `import {binary} from './full.min.mjs';\n\n// Read a .gp16 file as UTF-16LE, or pass the encoded string directly.\nconst bytes = binary(payload, ${JSON.stringify(opts, null, 2)});\n\n// Text / JSON\nconst text = new TextDecoder().decode(bytes);`;
}
async function loadExample(id) {
  const sample = state.samples.find((s) => s.id === id);
  if (!sample) return;
  await action("Decoding example…", async () => {
    state.sample = id;
    state.meta = {
      name: sample.name,
      mime: sample.mime,
      gzip: sample.id === "gzip",
    };
    showPayload(sample.packets[$("integrity").value]);
    const opts = options(),
      result = await rpc("decode", { payload: state.payload, options: opts });
    state.file = new File([result.bytes], sample.name, { type: sample.mime });
    $("input-name").textContent =
      sample.name + " · " + size(result.bytes.length);
    $("input").value =
      sample.id === "bytes" || sample.id === "gzip"
        ? "Binary file loaded. Choose Encode to repack it, or edit here to start a text input."
        : new TextDecoder().decode(result.bytes);
    $("gzip").checked = false;
    accept(result, state.meta, opts);
    document
      .querySelectorAll("#examples button")
      .forEach((b) => b.classList.toggle("active", b.dataset.example === id));
  });
}
$("encode").onclick = () =>
  action("Encoding in Rust/Wasm…", async () => {
    const raw = state.file
      ? new Uint8Array(await state.file.arrayBuffer())
      : utf8.encode($("input").value);
    if (raw.length > limit)
      throw Error(
        "The playground accepts files up to 16 MiB. Use the Rust CLI for larger files.",
      );
    const name = state.file?.name || "text.txt",
      mime = state.file?.type || "text/plain",
      gzip = $("gzip").checked,
      mode = $("integrity").value;
    const result = await rpc("encode", {
      bytes: raw,
      mode,
      gzip,
      exact: $("effort").value === "full",
    });
    state.sample = null;
    state.meta = {
      name: gzip ? name + ".gz" : name,
      mime: gzip ? "application/gzip" : mime,
      gzip: gzip || mime === "application/gzip" || /\.gz$/i.test(name),
    };
    showPayload(result.payload);
    accept(result, state.meta, options());
    $("timing").textContent =
      result.encodeMs.toFixed(3) + " ms · Rust encoding";
  });
$("decode").onclick = () =>
  action("Decoding…", async () => {
    showPayload(currentPayload());
    const opts = options();
    const result = await rpc("decode", {
      payload: state.payload,
      options: opts,
    });
    accept(result, state.meta, opts);
  });
$("input").addEventListener("input", () => {
  state.file = null;
  state.sample = null;
  $("input-name").textContent =
    "UTF-8 text · " + size(utf8.encode($("input").value).length);
});
$("payload").addEventListener("input", () => {
  state.payload = $("payload").value;
  state.sample = null;
});
async function fileIn(file) {
  if (!file || state.busy) return;
  if (file.size > limit) {
    status("The playground accepts files up to 16 MiB.", true);
    return;
  }
  state.file = file;
  state.sample = null;
  $("input-name").textContent = file.name + " · " + size(file.size);
  $("input").value =
    "File loaded. Choose Encode, or edit this field to start a text input.";
  status("Ready to encode " + file.name + ".");
}
$("file").onchange = () => fileIn($("file").files[0]);
for (const type of ["dragover", "dragleave", "drop"])
  $("file-drop").addEventListener(type, (event) => {
    event.preventDefault();
    $("file-drop").classList.toggle("dragging", type === "dragover");
    if (type === "drop") fileIn(event.dataTransfer.files[0]);
  });
$("payload-file").onchange = () =>
  action("Reading packed file…", async () => {
    const file = $("payload-file").files[0];
    if (!file) return;
    if (file.size > limit * 2 + 128)
      throw Error("The payload is too large for this playground.");
    const bytes = new Uint8Array(await file.arrayBuffer()),
      wide =
        /\.(gp16|utf16)$/i.test(file.name) ||
        (bytes[0] === 255 && bytes[1] === 254);
    if (wide && bytes.length % 2)
      throw Error("UTF-16LE payload has an odd byte count.");
    showPayload(
      new TextDecoder(wide ? "utf-16le" : "utf-8", { fatal: true }).decode(
        bytes,
      ),
    );
    state.sample = null;
    state.meta = {
      name: "decoded.bin",
      mime: "application/octet-stream",
      gzip: false,
    };
    status("Payload loaded. Select the matching integrity mode, then Decode.");
  });
for (const id of ["integrity", "format", "memory"])
  $(id).onchange = () => {
    snippet();
    if (state.sample) loadExample(state.sample);
  };
$("view").onchange = render;
$("restore").onclick = () => {
  const opts = state.lastOptions;
  state.meta = { ...state.lastMeta };
  $("integrity").value = opts.verifyData;
  $("format").checked = opts.verifyFormat;
  $("memory").checked = opts.memoryHeavy;
  state.sample = null;
  showPayload(state.goodPayload);
  $("decode").click();
};
function download(bytes, name, type) {
  const link = document.createElement("a"),
    url = URL.createObjectURL(new Blob([bytes], { type }));
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("download-bytes").onclick = () =>
  download(state.bytes, state.outputMeta.name, state.outputMeta.mime);
$("download-payload").onclick = () => {
  const data = new Uint8Array(state.payload.length * 2),
    view = new DataView(data.buffer);
  for (let i = 0; i < state.payload.length; i++)
    view.setUint16(i * 2, state.payload.charCodeAt(i), true);
  download(data, state.meta.name + ".gp16", "application/octet-stream");
};
$("copy-payload").onclick = async () => {
  try {
    await navigator.clipboard.writeText(state.payload);
    status("Encoded glyphs copied.");
  } catch {
    status(
      "Clipboard access is unavailable. Download the payload instead.",
      true,
    );
  }
};
$("inflate").onclick = () =>
  action("Inflating gzip locally…", async () => {
    const result = await rpc("inflate", { bytes: state.bytes });
    state.bytes = result.bytes;
    state.outputMeta = {
      name: displayName(state.outputMeta.name),
      mime: mediaType(displayName(state.outputMeta.name)),
      gzip: false,
    };
    render();
    status(
      "Gzip inflated · " +
        size(result.bytes.length) +
        ". The packed payload is unchanged.",
    );
  });
function literal(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
async function standalone() {
  await action("Building a standalone HTML file…", async () => {
    const response = await fetch("lib/full.min.mjs");
    if (!response.ok) throw Error("Unable to load the standalone decoder.");
    const source = await response.text(),
      payload = state.goodPayload,
      opts = options(),
      meta = { ...state.lastMeta };
    // Export the last successful payload with the policy that successfully read it.
    const mode = state.lastOptions || opts;
    const script = `const moduleUrl=URL.createObjectURL(new Blob([${literal(source)}],{type:'text/javascript'}));\nconst {binary}=await import(moduleUrl);URL.revokeObjectURL(moduleUrl);\nlet bytes=binary(${literal(payload)},${literal(mode)});\nconst meta=${literal(meta)};\nif(meta.gzip){bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());meta.name=meta.name.replace(/\\.gz$/i,'');meta.mime=meta.name.endsWith('.svg')?'image/svg+xml':meta.name.endsWith('.json')?'application/json':'application/octet-stream';}\ndocument.title=meta.name;document.querySelector('h1').textContent=meta.name;\nconst url=URL.createObjectURL(new Blob([bytes],{type:meta.mime}));const a=document.querySelector('a');a.href=url;a.download=meta.name;\nif(/^image\\/(png|jpeg|webp|gif|svg\\+xml)$/.test(meta.mime)){const img=document.createElement('img');img.src=url;img.alt=meta.name;document.querySelector('main').append(img);}else{const pre=document.createElement('pre');pre.textContent=new TextDecoder().decode(bytes.subarray(0,65536))||'[Empty file]';document.querySelector('main').append(pre);}`;
    const html = `<!doctype html><meta charset="utf-16le"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline' blob: 'wasm-unsafe-eval';style-src 'unsafe-inline';img-src blob:;base-uri 'none';object-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GlyphPack file</title><style>body{color-scheme:dark;background:#101214;color:#e7ebe8;max-width:900px;margin:40px auto;padding:20px;font:14px system-ui}h1{font-size:22px}a{color:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #394038;padding:20px}img{max-width:100%}</style><h1>Loading…</h1><a>Download original bytes</a><main></main><script type="module">${script}</script>`;
    const data = new Uint8Array(2 + html.length * 2),
      view = new DataView(data.buffer);
    view.setUint16(0, 0xfeff, true);
    for (let i = 0; i < html.length; i++)
      view.setUint16(2 + i * 2, html.charCodeAt(i), true);
    download(data, displayName(meta.name) + ".html", "text/html");
    status(
      "Standalone HTML downloaded. It includes the decoder and packed file.",
    );
  });
}
$("download-html").onclick = standalone;
$("recipe-html").onclick = standalone;
$("benchmark").onclick = () =>
  action("Measuring warmed decode calls in the worker…", async () => {
    const result = await rpc("benchmark", {
      payload: state.goodPayload,
      options: state.lastOptions || options(),
    });
    const table = document.createElement("table");
    table.innerHTML =
      "<thead><tr><th>Strategy</th><th>Median / decode</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const row of result.rows) {
      const tr = document.createElement("tr");
      for (const value of [
        row.memoryHeavy ? "256 KiB high-digit lookup" : "Compact lookup",
        (row.medianMs * 1000).toFixed(2) + " µs",
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    $("bench-result").replaceChildren(table);
    $("bench-panel").hidden = false;
    $("bench-panel").open = true;
    status(
      `Timed ${size(result.bytes)} · ${result.batch} decode(s) per batch.`,
    );
  });
$("run-checks").onclick = () =>
  action("Running verification examples…", async () => {
    const packet = state.samples.find((s) => s.id === "json").packets.secure;
    // Mutate an ordinary valid body symbol, keeping the header and alphabet valid.
    let code = packet.charCodeAt(2) + 1;
    while (
      code === 60 ||
      (code >= 127 && code <= 159) ||
      (code >= 55296 && code <= 57343) ||
      (code >= 64976 && code <= 65007) ||
      [65279, 8232, 8233].includes(code)
    )
      code++;
    const damaged =
        packet.slice(0, 2) + String.fromCharCode(code) + packet.slice(3),
      cases = [
        [
          "Changed bytes",
          damaged,
          { verifyFormat: true, verifyData: "secure" },
          "Payload digest mismatch",
        ],
        [
          "Truncated header",
          packet.slice(0, 1),
          { verifyFormat: false, verifyData: "secure" },
          "Invalid payload length",
        ],
        [
          "Extra pair · format on",
          packet + "  ",
          { verifyFormat: true, verifyData: "secure" },
          "Invalid payload length",
        ],
        [
          "Extra pair · format off",
          packet + "  ",
          { verifyFormat: false, verifyData: "secure" },
          "accepted",
        ],
      ];
    const table = document.createElement("table");
    table.innerHTML =
      "<thead><tr><th>Input</th><th>Actual result</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const [name, payload, opts, expected] of cases) {
      let actual = "accepted";
      try {
        await rpc("decode", { payload, options: opts });
      } catch (error) {
        actual = error.message;
      }
      const tr = document.createElement("tr");
      for (const text of [name, actual]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      tr.lastChild.className = actual === expected ? "pass" : "error";
      body.append(tr);
    }
    table.append(body);
    $("checks-result").replaceChildren(table);
    status("Verification examples complete. Your workbench is unchanged.");
  });
async function start() {
  const [samples] = await Promise.all([
    fetch("samples.json").then((r) => {
      if (!r.ok) throw Error("Unable to load examples");
      return r.json();
    }),
    ready,
  ]);
  state.samples = samples;
  for (const sample of samples) {
    const button = document.createElement("button");
    button.dataset.example = sample.id;
    const title = document.createElement("strong"),
      hint = document.createElement("span");
    title.textContent = sample.title;
    hint.textContent = size(sample.bytes);
    button.title = sample.description;
    button.append(title, hint);
    $("examples").append(button);
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-example]");
    if (button) loadExample(button.dataset.example);
  });
  buttons();
  snippet();
  await loadExample("json");
}
start().catch((error) => {
  status(error.message, true);
  $("engine-status").textContent = error.message;
});
