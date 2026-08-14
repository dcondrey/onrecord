import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { loadOrCreateContributorKeyPair } from '../dist/gateway/contributor-identity.js';
import { loadOrCreateKeyPair, signEntryCose, verifyCoseEntry } from '../dist/sign.js';
import { didKeyFromPublicJwk, verificationMethodForDid } from '../dist/did.js';

/**
 * Contributor keys must be reachable only from keys/contributors/, keyed by
 * sha256(handle), and must never verify against another contributor's or the
 * org's pubKey — that isolation is the entire point of the feature (#15).
 */

function stubUnsigned(id) {
  return {
    id,
    zone: 'Downtown',
    ask: { category: 'phone', summary: 'stub entry for signing test' },
    story: { raw: 'raw', shaped: 'shaped' },
    consent: { advocateId: 'adv_test', method: 'verbal, in person, witnessed', timestampISO: new Date().toISOString() },
    status: 'requested',
  };
}

test('loadOrCreateContributorKeyPair writes an isolated, mode-0600 key under keys/contributors/, keyed by sha256(handle)', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-contributor-'));
  try {
    const keys = await loadOrCreateContributorKeyPair('alice', baseDir);
    assert.ok(keys.pubKey);

    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('alice'));
    const expectedHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const keyPath = join(baseDir, 'keys', 'contributors', `${expectedHash}.json`);
    assert.ok(existsSync(keyPath), 'key must be written to keys/contributors/<sha256(handle)>.json');
    assert.ok(!existsSync(join(baseDir, 'keys', 'signing-key.json')), 'must never touch the org signing key path');

    const mode = (await stat(keyPath)).mode & 0o777;
    assert.equal(mode, 0o600);

    // Idempotent: a second load for the same handle returns the same key, not a new one.
    const again = await loadOrCreateContributorKeyPair('alice', baseDir);
    assert.equal(again.pubKey, keys.pubKey);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('two contributor handles get distinct keys, and signatures only verify against their own signer', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-contributor-'));
  try {
    const alice = await loadOrCreateContributorKeyPair('alice', baseDir);
    const bob = await loadOrCreateContributorKeyPair('bob', baseDir);
    const org = await loadOrCreateKeyPair(baseDir);

    assert.notEqual(alice.pubKey, bob.pubKey);
    assert.notEqual(alice.pubKey, org.pubKey);

    const aliceEntry = await signEntryCose(stubUnsigned('stub_alice'), alice);
    const bobEntry = await signEntryCose(stubUnsigned('stub_bob'), bob);

    assert.equal(await verifyCoseEntry(aliceEntry), true, 'alice-signed entry must verify against alice pubKey');
    assert.equal(await verifyCoseEntry(bobEntry), true, 'bob-signed entry must verify against bob pubKey');

    // Re-point alice's signed entry at bob's (then the org's) pubKey/issuer, keeping
    // alice's actual signature bytes — the signature check itself must fail closed,
    // not just an issuer-mismatch shortcut.
    const asSignedBy = (entry, otherKeys) => ({
      ...entry,
      provenance: {
        ...entry.provenance,
        pubKey: otherKeys.pubKey,
        issuer: didKeyFromPublicJwk(otherKeys.publicJwk),
        verificationMethod: verificationMethodForDid(didKeyFromPublicJwk(otherKeys.publicJwk)),
      },
    });

    assert.equal(await verifyCoseEntry(asSignedBy(aliceEntry, bob)), false, 'must not verify against another contributor pubKey');
    assert.equal(await verifyCoseEntry(asSignedBy(aliceEntry, org)), false, 'must not verify against the org pubKey');
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
