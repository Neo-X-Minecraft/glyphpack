// wasm-runtime.js
var littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function failure(status) {
  return status === 8 ? RangeError("Wasm decoder memory allocation failed") : Error(
    status === 2 ? "Invalid payload length" : status === 9 ? "Unsupported payload codec" : status === 10 ? "Unsupported memory optimization option" : status === 1 ? "Invalid payload character" : status === 3 ? "Invalid payload header" : status === 4 ? "Invalid payload padding" : status === 5 ? "Required payload integrity mode missing" : status === 7 ? "Payload digest mismatch" : "Wasm decoder failure"
  );
}
function warmWasm(api2, codecs, heavy) {
  let status = api2.warmup(codecs, heavy);
  if (status) throw failure(status);
}
function runWasm(api2, text, verifyFormat, dataKind, memoryHeavy) {
  let length = text.length;
  if (length < 2) throw failure(2);
  if (text.charCodeAt(0) !== 12) throw failure(9);
  let pointer = api2.input_ptr(length);
  if (pointer === 0 && length) throw failure(8);
  if (littleEndian) {
    let input = new Uint16Array(api2.memory.buffer, pointer, length);
    for (let i = 0; i < length; i++) input[i] = text.charCodeAt(i);
  } else {
    let input = new DataView(api2.memory.buffer, pointer, length * 2);
    for (let i = 0; i < length; i++)
      input.setUint16(i * 2, text.charCodeAt(i), !0);
  }
  let status = api2.decode(+verifyFormat, dataKind, +memoryHeavy);
  if (status) throw failure(status);
  let stored = api2.stored_len(), end = api2.payload_len(), bytes = new Uint8Array(stored);
  return bytes.set(new Uint8Array(api2.memory.buffer, api2.output_ptr(), stored)), end === stored ? bytes : bytes.subarray(0, end);
}

// loader.js
async function loadWasm(payload) {
  if (typeof WebAssembly > "u") throw Error("WebAssembly is required");
  if (typeof DecompressionStream > "u") throw Error("DecompressionStream is required");
  let compressed;
  if (Uint8Array.fromBase64) compressed = Uint8Array.fromBase64(payload);
  else {
    let text = atob(payload);
    compressed = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) compressed[i] = text.charCodeAt(i);
  }
  let bytes = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return (await WebAssembly.instantiate(bytes)).instance.exports;
}

// decoder.js
var api = await loadWasm("H4sIAAAAAAACA7RYVXTkyJJNpVJQJalKZXZV2b5Ke/YsM6PT53T3Q8My8yN55vUYhsEeWGb+fTw/S9/L/LNM38vMjD29ESFwuaa61+5zXpMyIyMj7o0bmZJbfc3JI55SykPw1co7++rw7Ozs+bMz9dU+DWju8T+ah34cedonVxP4njJhTEvu/Nwk0X4UPvKWR24fP6VV+PVv+brbX/8W5XXe8c5HHzv9qkdPj5Xu3n7stJn4yaNf89TDt7/m67/q4be8U5nuyent47dUkyB84muOH3nsURV2z98S/drIwxkM9Ifq3Bp4H6pX7Do/4rK04xOXP2GH7p///Cf/xC+LNQTQ7BCww9hu8CMlP4jfpvuVH/i53w8O7TKWsXHiFp6gEaDZFeQ1wuaJW3nCrpZFwda4CrBgI34Y8uhzmNj9z3v+6H3msNiiMMWJW33Cpuz+sXYTa1iXuB2MoXnrmHZ16W+OCFuyFPJCShz6HBCxpIwFYI/z5FU6VbKfsl5JIP1XZD1zf/Frr/xWWNoEGcVLJF6GZfY0drmkBYk2KO1cWUQQFh9qC0qFDroYyuoQa6XtCO5+adcw4NgE0g7Ipc/TBZpijTd/pF0raUH2LZRFH0O2firFyDAnITKMuHQSYw4xtko7XxYxh5L1LgFNJaQU6RPtFnKpB1d8Ebwlq3mM2OEzLcebk4xLEnWFsK8ixLzE67AT7CoScgvFIaGUSNi+ZTVC5jpflbouCCGytiw6xC5FD7nY+ohKm0rMCAZzAmq+0oEAsB+RIfRzEisvbU/2SWVDWNkZYoB1rhD6snOe6CyVNuZSRcjFJ+fa10X1sCi0Nf27RFH6YucohUSZlxQVCotUisMxYuK3QR4pFqpOqHogQFqC1qr6ljaT7UnJWsXcIehS8kWsiL1DrVjzHWCTu0ViDRjQgHzHzHZRYiWN6IvMtgPJK9UflegRjrpf+5iXZMw2EY+E8ORVxbCEYcnabAnbHkVZJXFq0mlT0BWJ9RBBDdssGbibu1z7XHTMaJF6krdnVS1JfdmeSbN3uNyUeh5WrDGpWXPtSav1kDWVW0BGxiGzXZBYvaZyC8w2huTlqte6dKs6EdsVScZse+LRQ6eufkJsN4TtmrDlw7TJ4vQbuIMJtpbApm2WUHooxaKs5cSMlg1rGyJuilV1bcgARNuQ2xwPNcqGSGq+GoNJbecJioeE2c5f1nZetG1xdFidrNE2q9lOa9urKkZsR9LJQ2GbUZTlS9pmU9o2OQLkouxCxRVhxbbL3UeUmmJNsu0I2xiLF9qG6NVsM+mu3mVtR1fTdvMa2q4L23GtrUb33tpOKJujEGXnL7NNgf9X28VZ2g6wNq0tXQxX0Xb5WtquCtuRsJVr5kramtnaeug+qLbD12q7ehVtNQbX0LYQtl57bteuqO3mbG23HlTb8Wu1Xb+KtsG1tF0Wtqu1tuaK2ubA7HO78aDajl6r7fLVzu3aNbTdFLYbrbbjK2mrkc/Wdvhg2noYvFbb4irammtoG2BJ2C4z21ZUjgZhUxU0k1grbUWX+UNntrbrzHZ5lrbLiOR13oq7CpK3kSDmbGHz7u61EGO5SmSxjlUEWG2RrPIZaLXtgfiWtl8WY9oW18qsQxNLJDUsXVq+mTOKMhbDqlw3zKbHKeoOSxBxPSSGh1w6aK1WN6IcGJEJXl2xtdKOEMn2SAB4UDDIyKPW3pQEZSgfQ4TYjrEqoYe0sea9ihWsS4h10sPSnw5GLHkHQwlRlHaIVfEYlXb15JN1DIUhp0AiZo88yKwk+ZATYETzMc094luwheYLGKOPNQFggBLUmMC6oBhX2ANoLIuDRlcOQ4BIHDaoftDkLcUkx01Z3BAAtLhJqUxFGZA2AaVMoaCxKZDGgDhrsq8INNLEQ0BTQ9MNDlAjzZMXbvqbZx/6TPT8pnIfe2gXtpTThdLb/Nudv5TyTzyp06/PlPvHFw3Puh/jKZfeMtuuU6jUS9x/vsheN8hAI/eul1KqUOK++6X0o5RYVeH52/Bs7DwmH7u73pHVLruZEWb3mfTQZ+7OXR/6RqaG0OSxcupWHnPvOtslA003jpx3+jHed79oEnf3rs8zGIpmzWd4//migaaQt7IqqfM+XSlCQuuf4akEBJ4yOK9QIOSatn4C77G7+5lYDIcWi0fpyT16PWHWQg3ej+xQvpd2XvWex+6zdnfn1c4X0qovq7w7bOPt1/Hi1nJQW7qtZa+2pK3lc8nCBbooOnZ37nrPvWIzFz9uCe5hz1eerxNnCo+rjYIyHwii/Wext/Pyf/rPP4vP3fnPH/rL6Pln7f7O/3zP30bP2V1isnxoKTiE1OGbRz/yhS0xfmCX6H2+aKBZzUBWGMArtu9eFunfTPZ/FdkrxgsuLgti6M7QJ2hve5xEwP7OHUr5+aPC6O26GSjvk2+k0AbKRaV78siqstDco2zV7vz8WRpQLs16li5/3Eafo2zvzbQaoXe4rdwZCVp3FzR1FCno89WquItj+GTCwodqAsPgY8KnEzakhWLwMOTA2KGkHb+ZTH02fTsP4B3SWJ+h63RZkIigcuyPijmClBIxm7jwkCjmJTU+aELASJwzcgxZvskmGlbG3kQntMZ8ohla49xkP5DRx37dYDio5dxr5NxlOZPnds7Pz/81+tLMr0MszEq2NCvZylQyMQ4n+08Q3L+hCAGdg7v/En1hi2A8K9n6rGSYSiZG2xo/r0awJwgOKHON4PMaBAezEWzNSvYhs5J96FQyMX54a/z8GsHnCoI9ylwj+PwGwd4lBORNZ8SRKTosPOw3Q42DZhhjrxmm1FJ9Z/hSWaoOUcYXoHvhxZfjh4ucjfCKCLowiAsfadGl21Ih2csMI4UioCXduZP3lB6ymd/VEV0T7lXvYXgl963nCKNPxxYBRwgkQjAdgS5anyNojuDJds3b+WqRfeae+yhzwJkVDGdut1rdZlaSeTZ2JZm17FOSUiNgHCq5L+d4krPfZI4lc3wlzukk51i2pwIgvj/ndJJzlzO3W216Dc7pBOe05dzBXEl88lO6Ev83OuKi0vBV/wgRd8nxMaVcOT1GfvLJSqHj4pL+MaUNis5016BPl1SSaC5Dn9+t9NjLqLycwkN2Qu/FCqc/G2d0I/PqGht4DdNooq/eaM5gApiLcpnpIIbLVfeUqXpKip4UCn0EhzZynoBz3rE1DFTDMEJ9BYTdSYS6Qdht+69B6LRgJCT3A6knQOoWZOR0hU9fxhdfF198GV98vQrGE+DiCXB+Bc6/DC69rrzpZXnTGtw2jNxRTQG9exeQY0kTI52AmibOtL95iV5c5tYIcTPQzcCrB4z51ihJdaIobWIV8evTW1o+I3KH8tbF51gf+eszDwsuL4sVp4p4U7mfm6Pu3FLIXfdxy+zkZU6DN4/Idjc6GtlVRramtymngnfo/CNr4JU23KNchhbhFTQQ9povX6ekmNWZ19JdfLTo0zBTk+tR2YzCdhS0I9OO/Hak25FXj1ipuLTqFmegWejOcxju52ePyEzvDcoYOv6KoYch1FCvrw+6Zio0L62G4m+nkMmEtGWaBC/Y8INGQl8i4Vnf4bBYhu/eRUrN0/PnBmUxpOf5XFmMqp8I9JnevviNmLmlWN2TnxgU+X73ubmjtLqT+N894K3t9HyAnPw98nfdU+Kukb9xxLaJqaUaLrqQv6GlJ8gsPbHoPodaYp1bYkMOTwHEWLtpC3g3jgqL+EeKXaekEfw7qZr6Ren/Mb/Hwh/ea+G37rXwczkWodw2aYMQi0SCplA8soq/Qn9e0T3B9ctLu1l0aAllYQjemFo/PywGSCwNqGiayoaONHeATmm76HBHBNwRpogQ8Pux6BGrDqKPUiJbxM0RocOPDnrcI722RyY9xUXc27nmub6Y+zz3L+aG5+ZiHvA8uJiHPA8v5hHPo7JFFjMyIsF91an6SvH7Y4vOBf8/GCGmrjEIShsw6eyGYcDdN2ce8TSEvgvzoVrOjSEghUGXHlwXPj58ySmyDRx5pPRIS2THBTU8MnlJHVE4SljhcV5hEuZbWU0pielGlB8xA9pCYDPnnxZLGPDPID10JN0buZuxdOhWjipMhUIPS48XXSh0pUI2IpS2B3N6zFgVmXiVeFdIG5yEI64eoT6jZN5NwjLgOmVObsdBU3BryNXpYkzLIS03hXfxaVIQp4pcJu4YNyUffJSKC8OP0OWnUFSMBAzT8JdI2dA4FfwEVYg/xHXdovqTM8mhJjpPcecpFx3ZSC6kDkydycg7qGm7iNsuutx2ZrLtzFTbmam2M1NtZ6bazky1nZlqO3PRdobLaabajm4x+Ug7H5TYxC4S6BuWQDgFjY2bVo2OLfXrMQzUCBHsKFfw4dNt9eNz9e0ls3fNVZdXSCKsg+8lqzlFfQMW3MExiUMvVyzDc8Epf6umBdfEq77Cfo7ugxAjDkeR7iRa1ZPv5klOiQJKlPMtNagncjMNKvx8idLoDwfljqJYzuTcDjikNIqamzV7vFA3CBP8Nqz/43P17Jxn75pLdUJ3ZdYB43ljpi/AEtDhJLbhbGw/PontXZexvavBljrDrG+OWox1Efj0du4LEFWhDDsJMqt4mfwEiEzITSCmRcxxyzROiDW/UP6PL7OGleQIwvDio2Xj8f3VwdAyM9Mxpc7NnMvsyBibMTHnzkPncubIuQxhS+5Se08Pal9QA1V/f/X3sDTIXk/FwO8XimCPE/yHGXs6Z5/hYRMRE1ET+qcwXeH3lU6+ei9993BQoJPvPhn/+HBQXie///3Ny4eDCjp59rc/HjscVNXJ3r+3vz0cVNLJl/9+fnA4qKyTb//0xK+Hg+o6+cSf+08fDipGJ9jlV7w5FuY1GqqoEXj9y57q6NTe/kHizNlz55OpdObCxUuXVdsWs6prN86onqBq2Bzvc55z1EcbJh8KR6Kx+M5uNvfAgw89/Mij1MYIHZvnHNc4rzrooifkuwLbENAV2B2wSagGeP3FnmoKZnu2mFUtu3FG1QSVL7Q1BuELbXtooClYb6CFmpBvCmyfGQJ7CTa5Mfvhnmi2aYtZtbIbZ5QjqDyhrWkKT2jb3GK9hRUcIV8T2CtmCGwHbDKkPPD6tT3lCmZrtphVA7txRq0F1Vhoa5piLLStwYMrWHcxwFrIDwS2B6MW2C5CS34PIDTNrM6/rHM0OfmZR1OdnJj14aDZdJfiuEIV4V69KtzTc+HeXwjPiGvRCZY0wIrWmKOOmv4pjLxZqDqm+i6uoghXrTgbcHaJiskGOhWJhsI7u7H4QWJvP51JplSRy1NTuqvc6UP6+zDcaVL/GNZ3lCvImabmyBv52MrH/8tpiAXKcNSYuxZYl8fMdJUwMy4vUDAYx2KcDcbBNZTQZEiVVQVMtkBKXC6jaiAVC6lsIBVMUcQSnloyyGVl0WLChhM3nH3DSRmOmnDxOgLU0WLxkPeDLeIb6GCNPOsc1vEWyiihgAZvVjhZ2jL4pp1PxRj2pmfZsDfdtcfa41Jly0SrdqIej7MT9TYT9VBGFRWMuLmnWbel+ZSLV+GdbE5VFDBBDwFDFpghLzOsywAOnzbLcDYTcE6bQN5O3BFPdwF5VNC9f0jrW5pXuHhNak4FBLiJAYoMmeOGtTncZnN4ms3iFptF5DGEr4Ybo6dfUAswxrft/Y3RPAJ4aOM63JNV5TO6xKPNWPiCQ4+LLnwebB36G4c+XHhw0GeIv7kMfcHfzN7DvuAvQI1cNMlDi2roUQsNcjCmJkbUQJd8dKiHNXUxpA7aNEKf2hhQH3H+ZovzF2WVb1i+pvjupwKmfDnxzFEx64Bvb7MuoYz/areKRcltIFhqe9CDy7xth+FRYJkZbtkPCDMzMzNz8gf5hNAlTKdw7uFLmBa6Is2TJ4yPWjVku0rS6+6p2WBxjPuXxUO5Z1kcUbYbWOxu9unpgXpQ3L4Z+asHD2/THOtEvI1bO28vlg8S8xE99DdeZmznXOycJ3ZGjEmx2GfuzM6LRromZryyZjg5dzq1nAAT/EYCfNcAgK/biwkwR71fJ+fC5FyYnAuT8/Cixq4/VL64VWH2ylPY2k6Q8Rsx+62Y+DyBii62CCUlc10hi+QxUnAwQXuRPERwEEG6SO4jOJCgtkjuIhglaC6S2wjGCDqL5CaCQwmyRXIdwQhBfZFc1Q91TYN1zZadcyUXcmUSrmaC/X/wBN9w/hVd+9uF5sL4UD9vM97Xz1NGY7HGeFs/bzLe1M87jNf184zRyK23HKldtb3tLLCdRmYRmDUS6YYw+mZZMOKmWTDKyLaR1bJgNNUtGEGpBaMmKCCFiwpIVICgNlCAoBkVEJLuFSDIogJC0r0CBFUqQNqTPKUI7G6y7aYo5H8WAOoogKMAriSA+4UAtSBAMwjQCQJkQYB6EKBKAeAFAAUQCiBBADckQM0L0PQCdLwAmReg7gWoTgqQFIgCJFEAgmoUICkvgSQuAYLSEkjiEiAIS0BT327xZbwU7v8jX0i+DFXykXz8gvzq35n94skXku/iviIKki+efNEqyRc/+8XPfvGzX/zsF2pQqrnTsFPxlrXI6A7R2Wx66axJStALgGQBbIZOOWVv8M2AU9fq1rasra2F9qxIL7ATgE5j5bRz7507FBwRQ4nPMSXm5qCNYZyvgG7Gg7/hXPXKgXHBDftYGHK6IhRrsaUN4cCdV8jan64JBongi8md3yYuIlEuuB5olBAaJYqUVgkVTecWlVNyI1ATPjChFcIPdgUjhKxGkVrfkA/+2QixqS0ZD8KZDp4bzQ/gCWjFBpm6vEqrjoJIq1kDwbTBEd9J8aOb/Ogp5+RKxdpLz6aFp5ups9js8ho5X/7QztPGpJvHzwUVNgcLeDcPym4e0M2jUBl288hvunkS/m9PvJsHv+/mWYssuyYRcBFknwvLJZZHLIdY/rDtwjYL2ypsoxx7ztHnHX/umP/oyzkjF9pHasbOPefYsQtPPuO4My88d/Scc/F7DxkdDT8EJx197kl/9ODTTj6Gd2M9HA4G8CWAEUT8HUhdxB8BmFfC7wCYWsIvAJgo4VcB9Ev4WQBjANRwAd4ONAA8oVcbw/e4BZbuqeb6vIzrUW6pHuFux+XuTtyFWbTl6XwtdKpO0w+kyI92y3SHexxXuIvcWXBYAOBdB+xjcYDfMjwKzsGskhpO9wBAeZL0nTQAAA==");
function warmup(codecs, memoryHeavy) {
  if (codecs === void 0 && (codecs = ["windows"]), !Array.isArray(codecs)) throw TypeError("Expected an array of payload codecs");
  if (memoryHeavy !== void 0) {
    if (!Array.isArray(memoryHeavy)) throw TypeError("Expected an array of memory flags");
    if (memoryHeavy.length !== codecs.length) throw Error("Warm-up lists must have the same length");
  }
  let mask = 0, heavy = 0;
  for (let i = 0; i < codecs.length; i++) {
    let codec = codecs[i], bit = codec === "windows" ? 4 : 0;
    if (!bit) throw failure(9);
    if (typeof (memoryHeavy === void 0 ? !1 : memoryHeavy[i]) != "boolean") throw TypeError("Expected boolean memory flags");
    mask |= bit;
  }
  warmWasm(api, mask & 7, heavy);
}
function binary(text) {
  if (text.length < 2) throw failure(2);
  if (text.charCodeAt(0) === 11) throw failure(9);
  if (text.charCodeAt(0) === 14) throw failure(9);
  return runWasm(api, text, !0, 2, !1);
}
export {
  binary,
  warmup
};
