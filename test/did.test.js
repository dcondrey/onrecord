import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  buildDidDocument,
  didKeyFromPublicJwk,
  resolvePinnedVerificationMethod,
  samePublicJwk,
  verificationMethodForDid,
} from '../dist/did.js';

/**
 * did.ts backs the only real trust-pinning mechanism this project has
 * (docs/protocol.md §6: "for an actual trust decision, pass a locally
 * pinned DID document") and was untested until now.
 */

async function generateP256Jwk() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return webcrypto.subtle.exportKey('jwk', pair.publicKey);
}

test('didKeyFromPublicJwk produces a deterministic did:key for a P-256 JWK', async () => {
  const jwk = await generateP256Jwk();
  const did1 = didKeyFromPublicJwk(jwk);
  const did2 = didKeyFromPublicJwk(jwk);
  assert.match(did1, /^did:key:z/);
  assert.equal(did1, did2, 'the same public key must always produce the same DID');
});

test('didKeyFromPublicJwk produces different DIDs for different keys', async () => {
  const [jwkA, jwkB] = await Promise.all([generateP256Jwk(), generateP256Jwk()]);
  assert.notEqual(didKeyFromPublicJwk(jwkA), didKeyFromPublicJwk(jwkB));
});

test('didKeyFromPublicJwk rejects a non-P-256 or incomplete JWK', () => {
  assert.throws(() => didKeyFromPublicJwk({ kty: 'RSA' }));
  assert.throws(() => didKeyFromPublicJwk({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' }));
  assert.throws(() => didKeyFromPublicJwk({ kty: 'EC', crv: 'P-256', x: 'a' })); // missing y
});

test('verificationMethodForDid appends #key-1', () => {
  assert.equal(verificationMethodForDid('did:key:zABC'), 'did:key:zABC#key-1');
});

test('buildDidDocument wires id, verificationMethod, authentication, and assertionMethod consistently', async () => {
  const jwk = await generateP256Jwk();
  const did = didKeyFromPublicJwk(jwk);
  const doc = buildDidDocument(did, jwk);
  const method = verificationMethodForDid(did);

  assert.equal(doc.id, did);
  assert.equal(doc.verificationMethod[0].id, method);
  assert.equal(doc.verificationMethod[0].controller, did);
  assert.deepEqual(doc.verificationMethod[0].publicKeyJwk, jwk);
  assert.deepEqual(doc.authentication, [method]);
  assert.deepEqual(doc.assertionMethod, [method]);
});

test('resolvePinnedVerificationMethod returns the pinned key only when the DID and method both match', async () => {
  const jwk = await generateP256Jwk();
  const did = didKeyFromPublicJwk(jwk);
  const doc = buildDidDocument(did, jwk);
  const method = verificationMethodForDid(did);

  assert.deepEqual(resolvePinnedVerificationMethod(doc, method), jwk);
});

test('resolvePinnedVerificationMethod rejects a method whose DID prefix does not match the pinned document', async () => {
  const jwk = await generateP256Jwk();
  const did = didKeyFromPublicJwk(jwk);
  const doc = buildDidDocument(did, jwk);

  assert.equal(resolvePinnedVerificationMethod(doc, 'did:key:zSOMEONE-ELSE#key-1'), undefined);
});

test('resolvePinnedVerificationMethod rejects a malformed method (no #, or # at position 0)', async () => {
  const jwk = await generateP256Jwk();
  const did = didKeyFromPublicJwk(jwk);
  const doc = buildDidDocument(did, jwk);

  assert.equal(resolvePinnedVerificationMethod(doc, did), undefined); // no '#'
  assert.equal(resolvePinnedVerificationMethod(doc, '#key-1'), undefined); // '#' at position 0
});

test('resolvePinnedVerificationMethod returns undefined when the document has no verificationMethod array', () => {
  assert.equal(resolvePinnedVerificationMethod({ id: 'did:key:zABC' }, 'did:key:zABC#key-1'), undefined);
});

test('samePublicJwk compares kty/crv/x/y, ignoring other fields', async () => {
  const jwk = await generateP256Jwk();
  assert.equal(samePublicJwk(jwk, { ...jwk, kid: 'unrelated-extra-field' }), true);
  assert.equal(samePublicJwk(jwk, { ...jwk, x: jwk.x?.slice(0, -1) + (jwk.x?.endsWith('A') ? 'B' : 'A') }), false);
});
