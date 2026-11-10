import { binary as fixed } from "glyphpack";
import { binary as full, type DecodeOptions } from "glyphpack/full";
import { binary as core } from "glyphpack/core";
import { binary as fast } from "glyphpack/fast-none";
const options: DecodeOptions = {
  verifyFormat: true,
  verifyData: "secure",
  memoryHeavy: false,
};
const bytes: Uint8Array = full("", options);
full("", { verifyData: true });
full("", { verifyData: false });
fixed("");
core("");
fast("", { verifyData: "fast", verifyFormat: false });
// @ts-expect-error Fixed profiles do not expose ignored runtime options.
fixed("", { verifyData: "none" });
// @ts-expect-error Core has no runtime verifier.
core("", { verifyFormat: false });
// @ts-expect-error Secure verification was omitted from this profile.
fast("", { verifyData: "secure" });
// @ts-expect-error Memory policy is fixed in this profile.
fast("", { memoryHeavy: true });
// @ts-expect-error Unsupported data mode.
full("", { verifyData: "crc32" });
// @ts-expect-error Format checking accepts booleans.
full("", { verifyFormat: "true" });
// @ts-expect-error Encoded payloads are strings.
full(bytes);
