import type { JsonWebKey } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i]! << 8; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = ''; for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!]!;
  return out;
}

function b64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

/** did:key for a P-256 public JWK (multicodec p256-pub, 0x1200). */
export function didKeyFromPublicJwk(jwk: JsonWebKey): string {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('did:key requires a P-256 public JWK');
  const raw = new Uint8Array(65); raw[0] = 4; raw.set(b64url(jwk.x), 1); raw.set(b64url(jwk.y), 33);
  return `did:key:z${base58(Uint8Array.of(0x80, 0x24, ...raw))}`;
}

export function verificationMethodForDid(did: string): string {
  return `${did}#key-1`;
}

export interface DidDocument {
  id: string;
  verificationMethod: [{ id: string; type: 'JsonWebKey2020'; controller: string; publicKeyJwk: JsonWebKey }];
  authentication: [string];
  assertionMethod: [string];
}

export interface DidTrustDocument {
  id: string;
  verificationMethod?: Array<{ id: string; publicKeyJwk?: JsonWebKey }>;
}

export function buildDidDocument(did: string, publicJwk: JsonWebKey): DidDocument {
  const id = verificationMethodForDid(did);
  return { id: did, verificationMethod: [{ id, type: 'JsonWebKey2020', controller: did, publicKeyJwk: publicJwk }], authentication: [id], assertionMethod: [id] };
}

/** Return the public JWK named by a locally pinned DID document. */
export function resolvePinnedVerificationMethod(document: DidTrustDocument, method: string): JsonWebKey | undefined {
  const separator = method.indexOf('#');
  if (!document.verificationMethod || separator < 1 || document.id !== method.slice(0, separator)) return undefined;
  return document.verificationMethod.find((candidate) => candidate.id === method)?.publicKeyJwk;
}

export function samePublicJwk(a: JsonWebKey, b: JsonWebKey): boolean {
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}
