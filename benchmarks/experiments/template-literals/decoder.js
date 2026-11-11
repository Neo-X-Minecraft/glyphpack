// 0BSD, NeoX. Independent JS reference decoder for these experimental alphabets.
// This parser returns stored bytes INCLUDING the digest. The harness compares
// their SHA-256 with Rust's expected file; this is not a production hash verifier.
const experimentalTables = [];
function experimentalAlphabet(id) {
    if (experimentalTables[id]) return experimentalTables[id];
    if (id >= 10) {
        const excluded = [[13,92,96],[13,96],[13,60],[13,36,60,92,96],[],[0,13,96]][id-10];
        const chars = new TextDecoder("windows-1252",{fatal:true}).decode(
            Uint8Array.from({length:256},(_,i)=>i));
        const table = new Int32Array(65536).fill(-1);
        let radix = 0;
        for (let i=0;i<256;i++) {
            const cp = i===0 && id!==15 ? 65533 : chars.charCodeAt(i);
            if (!excluded.includes(cp)) table[cp] = radix++;
        }
        return experimentalTables[id] = {table,radix,threshold:radix*radix-32769};
    }
    const excluded = [null, null, [0,13,60], [0,13,92,96],
        [0,13,36,92,96], [0,13], [], [], [0,13,96], [0,13,36,60,92,96]][id];
    const table = new Int32Array(65536).fill(-1);
    let radix = 0;
    for (let c = 0; c < 65536; c++) {
        if (id < 2) {
            if (c < 32 || c >= 65534 || c === 60 || c >= 127 && c <= 159 ||
                c >= 55296 && c <= 57343 || c >= 64976 && c <= 65007 ||
                c === 65279 || c === 8232 || c === 8233) continue;
        } else if (id !== 7 && c >= 55296 && c <= 57343 || excluded.includes(c)) continue;
        table[c] = radix++;
    }
    return experimentalTables[id] = {table, radix, threshold: radix * radix - 2147483649};
}
function experimentalDecode(text, id) {
    const {table, radix, threshold} = experimentalAlphabet(id);
    const digit = i => {
        const d = table[text.charCodeAt(i)];
        if (!Number.isInteger(d) || d < 0) throw Error("Invalid experimental symbol");
        return d;
    };
    const first = digit(0), second = digit(1);
    if (id >= 10) {
        const settings = first + radix * second, mask = settings & 255;
        let size=0, power=1;
        for(let i=2;i<6;i++) {size+=digit(i)*power;power*=radix;}
        if(settings>>>8!==2 || size<32 || size>text.length-6 || (text.length-6)%2)
            throw Error("Invalid byte-profile header");
        const out = new Uint8Array(size);
        let queue=0,bits=0,at=0;
        for(let i=6;i<text.length;i+=2) {
            const value=digit(i)+radix*digit(i+1);
            const width=(value&32767)>threshold?15:16;
            queue|=value<<bits;bits+=width;
            while(bits>=8) {
                const byte=queue&255;
                if(at<size) out[at]=byte^mask;
                else if(byte) throw Error("Nonzero byte-profile padding");
                at++;queue>>>=8;bits-=8;
            }
        }
        if(at<size || at>size+1 || queue)throw Error("Invalid byte-profile coverage");
        return out;
    }
    const settings = first & 1023, mask = settings & 255;
    let start = 2, size = (first >>> 10) * radix + second;
    if (first >= 32768) {
        if (first >= 33792) throw Error("Invalid experimental header");
        start = 3; size = second + radix * digit(2);
    }
    if (settings >>> 8 !== 2 || !Number.isSafeInteger(size) || size < 32 ||
        size > (text.length - start) * 2 || (text.length - start) % 2)
        throw Error("Invalid experimental size");
    const out = new Uint8Array(size), xor = mask * 0x01010101;
    let carry = 0, shift = 0, offset = 0, lastWord = 0, advance = 0;
    for (let pos = start; pos < text.length; pos += 2) {
        const value = digit(pos) + radix * digit(pos + 1);
        const word = carry | value << shift;
        lastWord = word;
        const plain = word ^ xor;
        out[offset] = plain; out[offset+1] = plain >>> 8;
        out[offset+2] = plain >>> 16; out[offset+3] = plain >>> 24;
        const narrow = (value & 0x7fffffff) > threshold;
        if (shift === 0 && narrow) {
            carry = word >>> 24; shift = 7; advance = 3;
        } else {
            carry = shift ? value >>> (32 - shift) : 0;
            shift -= narrow; advance = 4;
        }
        offset += advance;
    }
    const remaining = size - offset + advance;
    if (offset < size || remaining <= 0 || carry ||
        remaining < 4 && lastWord >>> (8 * remaining))
        throw Error("Invalid experimental coverage/padding");
    return out;
}
globalThis.experimentalDecode = experimentalDecode;
