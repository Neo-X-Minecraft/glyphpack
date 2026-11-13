// Generated GlyphPack declaration; policies match this specialized module.
export interface DecodeOptions {
  verifyFormat?: boolean;
  verifyData?: 'none' | false | 'fast' | 'secure' | true;
  memoryHeavy?: boolean;
}
export declare function binary(text: string, options?: DecodeOptions): Uint8Array;
export declare function warmup(codecs?: readonly ('pair' | 'ans' | 'windows' | 'utf8' | 'utf8-compact')[], memoryHeavy?: readonly boolean[]): void;
/** Strict raw transport, without integrity verification. */
export declare function decodeRawUtf8(text: string): Uint8Array;
/** Strict raw transport, without integrity verification. */
export declare function decodeRawUtf8Compact(text: string): Uint8Array;
