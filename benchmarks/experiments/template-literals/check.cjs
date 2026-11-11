// 0BSD, NeoX. Check real HTML bytes under file://, not eval() alone. Native
// crypto hashes the resulting UTF-16 units or decoded bytes outside any timing.
"use strict";
const fs = require("node:fs"), path = require("node:path"),
    crypto = require("node:crypto"), assert = require("node:assert/strict"),
    {pathToFileURL} = require("node:url"), {chromium} = require("playwright");
const root = path.resolve(__dirname, "../../.."),
    folder = path.join(root, "generated/template-literals"),
    manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"))),
    decoder = fs.readFileSync(path.join(__dirname, "decoder.js"), "utf8");
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const browsers = [
    {path: process.env.CHROMIUM_BIN || "/usr/bin/chromium",
     version: process.env.CHROMIUM_VERSION || require("../../chromium.json").version},
    {path: process.env.CHROMIUM109_BIN || path.join(root, ".tools/chromium109/chromium"),
     version: "109.0.5414.119"}
];
(async () => {
    const report = {pass:false, date:new Date().toISOString(),
        manifestSha256:sha(fs.readFileSync(path.join(folder,"manifest.json"))),
        decoderSha256:sha(Buffer.from(decoder)), rows:[]};
    for (const config of browsers) {
        assert(fs.existsSync(config.path), "Both requested browsers are required");
        const browser = await chromium.launch({executablePath:config.path,
            headless:true, args:["--no-sandbox"]});
        assert.equal(browser.version(), config.version);
        try {
            const context = await browser.newContext();
            await context.setOffline(true);
            await context.addInitScript({content:decoder});
            let count = 0;
            for (const test of manifest.cases) {
                for (const style of test.classicToo ? ["module", "classic-strict"] : ["module"]) {
                    const expected = fs.readFileSync(path.join(folder,test.expectedUnits || test.stored)),
                        expectedSha = sha(expected);
                    let file = path.join(folder,test.html);
                    if (style === "classic-strict") {
                        const encoding = test.encoding === "windows-1252" ? "latin1" : "utf16le";
                        const html = fs.readFileSync(file).toString(encoding)
                            .replaceAll('type="module">', '>"use strict";');
                        file = file.replace(/\.html$/, ".classic.html");
                        fs.writeFileSync(file, Buffer.from(html,encoding));
                    }
                    const page = await context.newPage(), errors = [], requests = [];
                    page.on("pageerror", e => errors.push(e.message));
                    page.on("request", r => {if(/^https?:/.test(r.url()))requests.push(r.url());});
                    await page.goto(pathToFileURL(file).href, {timeout:60000});
                    const result = await page.evaluate(async ({id}) => {
                        const text = globalThis.packet;
                        const markers = !!document.getElementById("end");
                        const scripts = document.scripts.length;
                        if (typeof text !== "string")
                            return {present:false,markers,scripts,injected:!!globalThis.injected};
                        const out = id === null ? new Uint8Array(text.length * 2) :
                            experimentalDecode(text,id);
                        if (id === null) for(let i=0;i<text.length;i++) {
                            const c=text.charCodeAt(i);out[i*2]=c;out[i*2+1]=c>>>8;
                        }
                        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",out));
                        return {present:true,markers,scripts,charset:document.characterSet.toLowerCase(),units:text.length,bytes:out.length,
                            injected:!!globalThis.injected,
                            sha256:Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("")};
                    }, {id:test.expectedUnits?null:test.profile}).catch(e => ({error:e.message}));
                    const exact = result.sha256 === expectedSha;
                    if (test.negative) {
                        assert(!exact, "Negative control unexpectedly round-tripped: "+test.name);
                    } else {
                        assert(exact, test.name+" / "+style+": "+JSON.stringify({result,errors}));
                        assert.equal(result.markers,true,test.name);
                        assert.equal(result.injected,false,test.name);
                        assert.equal(result.scripts,test.expectedScripts,test.name);
                        assert.equal(result.charset,test.encoding,test.name);
                        assert.equal(errors.length,0,test.name+": "+errors.join("; "));
                    }
                    assert.equal(requests.length,0);
                    report.rows.push({browser:browser.version(),name:test.name,style,
                        negative:test.negative,exact,networkRequests:requests.length,
                        ...result,errors});
                    await page.close();
                    count++;
                    if (count % 25 === 0) console.log(browser.version()+": "+count+" cases");
                }
            }
            await context.close();
            console.log(browser.version()+": passed "+count+" cases");
        } finally { await browser.close(); }
    }
    report.pass = true;
    fs.writeFileSync(path.join(folder,"browser-results.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify({pass:true,cases:report.rows.length,report:"generated/template-literals/browser-results.json"}));
})().catch(e => {console.error(e);process.exitCode=1});
