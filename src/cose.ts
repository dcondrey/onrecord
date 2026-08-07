/** COSE_Sign1 (RFC 9052) for detached deterministic-CBOR payloads. */

import { webcrypto, type JsonWebKey } from 'node:crypto';
import { decode, encodeCanonical } from './cbor.js';
import { fromBase64, toBase64 } from './encoding.js';

const subtle = webcrypto.subtle;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ES256 = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface CoseSign1 {
  /** Base64-encoded tagged COSE_Sign1 structure. */
  sign1: string;
  /** Base64-encoded detached payload represented by the signature. */
  payload: string;
  algorithm: 'ES256';
}

function sigStructure(protectedHeaders: Uint8Array, payload: Uint8Array, externalAad = new Uint8Array()): Uint8Array {
  return encodeCanonical(['Signature1', protectedHeaders, externalAad, payload]);
}

export async function signCoseSign1(payload: Uint8Array, privateJwk: JsonWebKey, kid?: string): Promise<CoseSign1> {
  const headerMap = new Map<number, unknown>([[1, -7], [3, 'application/cbor']]);
  if (kid) headerMap.set(4, new TextEncoder().encode(kid));
  const protectedHeaders = encodeCanonical(headerMap);
  const key = await subtle.importKey('jwk', privateJwk, ECDSA, false, ['sign']);
  const signature = await subtle.sign(ES256, key, sigStructure(protectedHeaders, payload));
  // A detached payload is represented by nil in COSE_Sign1; the payload is
  // transported beside it so the same envelope can be verified offline.
  const structure = encodeCanonical([protectedHeaders, {}, null, new Uint8Array(signature)]);
  const tagged = new Uint8Array(structure.length + 1); tagged[0] = 0xd2; tagged.set(structure, 1);
  return { sign1: toBase64(tagged), payload: toBase64(payload), algorithm: 'ES256' };
}

export async function verifyCoseSign1(value: CoseSign1, payloadOverride?: Uint8Array, publicJwk?: JsonWebKey): Promise<boolean> {
  const decoded = decode(fromBase64(value.sign1), { useMaps: true });
  if (!Array.isArray(decoded) || decoded.length !== 4) return false;
  const [protectedRaw, unprotected, embeddedPayload, signature] = decoded;
  if (!(protectedRaw instanceof Uint8Array) || !(signature instanceof Uint8Array) || !(unprotected instanceof Map || (unprotected && typeof unprotected === 'object'))) return false;
  const payload = payloadOverride ?? fromBase64(value.payload);
  if (embeddedPayload !== null) return false;
  const protectedHeaders = decode(protectedRaw, { useMaps: true });
  const alg = protectedHeaders instanceof Map
    ? protectedHeaders.get(1)
    : (protectedHeaders as Record<string, unknown>)['1'];
  if (alg !== -7) return false;
  if (!publicJwk) return false;
  const key = await subtle.importKey('jwk', publicJwk, ECDSA, false, ['verify']);
  return subtle.verify(ES256, key, signature, sigStructure(protectedRaw, payload));
}

/** Extract the COSE key identifier (kid) from a signed structure, if present. */
export function coseKid(sign1: string): string | undefined {
  const decoded = decode(fromBase64(sign1), { useMaps: true });
  if (!Array.isArray(decoded) || !(decoded[0] instanceof Uint8Array)) return undefined;
  const headers = decode(decoded[0], { useMaps: true });
  const value = headers instanceof Map ? headers.get(4) : (headers as Record<string, unknown>)['4'];
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : undefined;
}
