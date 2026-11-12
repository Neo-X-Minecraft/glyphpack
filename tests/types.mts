import { binary as fixed, warmup as warmFixed } from "glyphpack";
import { binary as full, warmup, type DecodeOptions } from "glyphpack/full";
import { binary as core } from "glyphpack/core";
import { binary as ans, warmup as warmAns } from "glyphpack/ans";
import { binary as windows, warmup as warmWindows } from "glyphpack/windows";
import { binary as fast } from "glyphpack/fast-none";
import {
  binary as recommended,
  warmup as warmRecommended,
} from "glyphpack/recommended";
import {
  binary as recommendedFull,
  warmup as warmRecommendedFull,
} from "glyphpack/recommended-full";
const options: DecodeOptions = {
  verifyFormat: true,
  verifyData: "secure",
  memoryHeavy: false,
};
const bytes: Uint8Array = full("", options);
warmFixed();
warmAns();
warmWindows();
warmup(["pair", "ans"]);
warmup(["windows", "pair", "ans"] as const);
warmup([]);
warmFixed(["pair"]);
warmup();
warmup(["ans", "pair"], [true, false]);
warmup(undefined, [false]);
warmRecommended();
warmRecommended(["pair"], [false]);
warmRecommendedFull(["ans", "pair"], [true, false]);
recommended("");
recommendedFull("");
// @ts-expect-error Pair-only builds cannot warm omitted codecs.
warmFixed(["ans"]);
// @ts-expect-error Recommended full omits Windows.
warmRecommendedFull(["windows"]);
// @ts-expect-error Recommended verification is fixed on.
recommendedFull("", { verifyData: "none" });
// @ts-expect-error Memory flags must be booleans.
warmup(["pair"], [1]);
// @ts-expect-error Warm-up accepts codec names, not verification policies.
warmup(["secure"]);
// @ts-expect-error A single name still goes inside an array.
warmup("ans");
full("", { verifyData: true });
full("", { verifyData: false });
fixed("");
ans("");
windows("");
// @ts-expect-error Codec selection is encoded in the data, not a runtime option.
full("", { packing: "ans" });
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
