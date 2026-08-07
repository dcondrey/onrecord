import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCanonical, decode } from '../dist/cbor.js';
import { signCoseSign1, verifyCoseSign1 } from '../dist/cose.js';
import { webcrypto } from 'node:crypto';

const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('canonical CBOR sorts map keys and round-trips', () => {
  const bytes = encodeCanonical({ b: 1, a: 2 });
  assert.equal(hex(bytes), 'a2616102616201');
  assert.deepEqual(decode(bytes), { a: 2, b: 1 });
});

test('COSE_Sign1 uses detached payload and verifies', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const payload = new TextEncoder().encode('on-record test vector');
  const signed = await signCoseSign1(payload, privateJwk, 'key-1');
  assert.equal(await verifyCoseSign1(signed, payload, publicJwk), true);
  assert.equal(await verifyCoseSign1(signed, new TextEncoder().encode('tampered'), publicJwk), false);
});
