// Run with: node examples/usage-none.mjs
import {binary} from '../dist/none.min.mjs';

// Both optional checks and hash implementations are omitted from this build.
// The packet also omits its digest: encode - --checksum none --mask 0 --text.
const payload = "\t 9\u5002\u705e\uf744\u768b\ua82e\u9358\u8f7d\ue03b\u9b54\ue654\u1874\u3bfe\u0169 ";
console.log(new TextDecoder().decode(binary(payload)));
