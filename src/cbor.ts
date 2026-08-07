/** RFC 8949 deterministic CBOR boundary used by both Node and browser builds. */

import { decode as cborgDecode, encode as cborgEncode, rfc8949EncodeOptions } from 'cborg';

export class CborError extends Error {
  override readonly name = 'CborError';
}

/** RFC 8949 core deterministic encoding, including preferred integer widths. */
export function encodeCanonical(value: unknown): Uint8Array {
  try {
    return cborgEncode(value, rfc8949EncodeOptions);
  } catch (error) {
    throw new CborError(error instanceof Error ? error.message : String(error));
  }
}

export function decode(bytes: Uint8Array, options: { useMaps?: boolean } = {}): unknown {
  try {
    return cborgDecode(bytes, { ...options, tags: { 18: (nested: { (): unknown }) => nested() } });
  } catch (error) {
    throw new CborError(error instanceof Error ? error.message : String(error));
  }
}
