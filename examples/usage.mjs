// Run with: node examples/usage.mjs
import {binary} from '../dist/core.min.mjs';

// Encoded using checksum='none'; the base module performs no verification.
const encodedText=" C\u5002\u705e\uf744\u768b\u88d0\uf866\ub6d3\ucb2d\uc2d1\u4341\u7aed\ue893\u8e1f\u433f\u8a70\ud1ee\u430a ";
const bytes=binary(encodedText);
console.log(new TextDecoder().decode(bytes));
