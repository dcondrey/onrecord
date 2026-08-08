import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCanonical, decode } from '../dist/cbor.js';
import { signCoseSign1, verifyCoseSign1 } from '../dist/cose.js';
import { dobCandidates, dobIsAmbiguous, normalizeDob, recoveryIdentityTag } from '../dist/recovery.js';
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

test('identity recovery follows the needle-exchange fields without storing them', async () => {
  const identity = { first3: 'mar', last3: 'del', dateOfBirth: '1984-02-03', postalCode: '92101' };
  const tag = await recoveryIdentityTag(identity, '4417', 'or_test');
  assert.equal(tag.length, 64);
  assert.notEqual(tag, await recoveryIdentityTag(identity, '4418', 'or_test'));
  assert.notEqual(tag, await recoveryIdentityTag({ ...identity, postalCode: '92102' }, '4417', 'or_test'));
});

test('DOB intake accepts human formats and flags ambiguity', () => {
  assert.equal(normalizeDob('March 5th, 1984'), '1984-03-05');
  assert.equal(normalizeDob('05-03-84'), '1984-05-03');
  assert.equal(normalizeDob('5 March nineteen eighty four'), '1984-03-05');
  assert.equal(normalizeDob("03/5/'84"), '1984-03-05');
  assert.equal(dobIsAmbiguous('01/02/1980'), true);
  assert.deepEqual(dobCandidates('01-01-01'), ['2001-01-01']);
  assert.equal(dobIsAmbiguous('13/02/1980'), false);
});
