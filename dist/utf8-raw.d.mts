/** Raw UTF-8 transport. Checks encoding structure, without a digest or MAC. */
export declare function decode(text: string): Uint8Array;
/** Optional, idempotent 4 KiB lookup initialization; decode calls it automatically. */
export declare function warmup(): void;
