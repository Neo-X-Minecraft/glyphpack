// Run with: node examples/usage.mjs
import {binary, warmup} from '../dist/default.min.mjs';

// This profile fixes strict format checks and BLAKE3 verification on.
// The native encoder used: encode - --packing pair --checksum secure --mask 0 --text.
const payload = "\t\u0242Z\u5002\u705e\uf744\u768b\ua82e\u9358\u8f7d\ue03b\u9b54\ue654\u1874\u3bfe\u847a\u975d\u07df\uaec0\ub0a9\uc948\uae04\u75e3\u8e72\u7613\u4a52\ucfcf\uf754\u51b6\ucdaa\ud005\u06d0 ";
warmup(); // Optional: binary() initializes its selected codec automatically.
console.log(new TextDecoder().decode(binary(payload)));
