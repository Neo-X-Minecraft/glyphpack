// Run with: node examples/usage-full.mjs
import {binary} from '../dist/full.min.mjs';

// All twelve combinations are included. Defaults: format=true, data=secure,
// memoryHeavy=false. The 256 KiB lookup is cached after its first true use.
const packets={
  "secure": "\u0242c\u5002\u705e\uf744\u768b\u88d0\uf866\u3afd\ud373\u3302\u4350\u7aed\ue893\u8e1f\u433f\u8a70\ud1ee\ua81f\u6967\uee04\u2d5c\ubdf9\u95b8\u38e5\ucc57\u2c46\u53f7\u8475\u798f\u3103\ufb11\u9a6e\u9185\u67aa ",
  "fast": "\u0142G\u5002\u705e\uf744\u768b\u88d0\uf866\u3afd\ud373\u3302\u4350\u7aed\ue893\u8e1f\u433f\u8a70\ud1ee\u443c\u1e40\u9125 ",
  "none": " C\u5002\u705e\uf744\u768b\u88d0\uf866\u3afd\ud373\u3302\u4350\u7aed\ue893\u8e1f\u433f\u8a70\ud1ee\u430a "
};
console.log('Default:',new TextDecoder().decode(binary(packets.secure)));

for(const memoryHeavy of [false,true]){
  for(const verifyFormat of [true,false]){
    for(const verifyData of ['secure','fast','none']){
      const bytes=binary(packets[verifyData],{verifyFormat,verifyData,memoryHeavy});
      console.log({verifyFormat,verifyData,memoryHeavy},new TextDecoder().decode(bytes));
    }
  }
}
