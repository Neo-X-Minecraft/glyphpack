// Run with: node examples/usage-none.mjs
import {binary} from '../dist/none.min.mjs';

// Encode with checksum='none' to omit the payload digest too.
const payload=" H\u5002\u705e\uf744\u768b\u88d0\uf866\u3aea\uebfe\u99db\u5e23\u9394\u7702\ub38e\uf593\uf708\u96b9\ua52e\u96f3\u155d\u00cc";
console.log(new TextDecoder().decode(binary(payload)));
