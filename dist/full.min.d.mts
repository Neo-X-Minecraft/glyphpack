// Generated GlyphPack declaration; policies match this specialized module.
export interface DecodeOptions {
  verifyFormat?: boolean;
  verifyData?: 'none' | false | 'fast' | 'secure' | true;
  memoryHeavy?: boolean;
}
export declare function binary(text: string, options?: DecodeOptions): Uint8Array;
