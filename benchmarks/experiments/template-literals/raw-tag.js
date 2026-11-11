// 0BSD, NeoX. Only the reserved source sequences are reversed. Source encodes
// k original slashes as 2k+1, so existing escape lookalikes cannot collide.
function rawTag(parts) {
    const restore = run => "\\".repeat((run.length - 1) / 2);
    // Always consume a complete slash run, even when no marker follows. A
    // mandatory suffix after an unanchored run can backtrack quadratically.
    return parts.raw[0].slice(0, -1)
        .replace(/(\\+)(\x24\{)?/g, (all, run, interpolation) => interpolation ? restore(run) + interpolation : all)
        .replace(/<(\\+)(!--|\/script)/gi, (_, run, end) => "<" + restore(run) + end);
}
