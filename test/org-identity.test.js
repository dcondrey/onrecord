import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { loadOrCreateOrgKeyPair } from '../dist/gateway/org-identity.js';
import { loadOrCreateContributorKeyPair } from '../dist/gateway/contributor-identity.js';
import { loadOrCreateKeyPair, signEntryCose, verifyCoseEntry } from '../dist/sign.js';
import { didKeyFromPublicJwk, verificationMethodForDid } from '../dist/did.js';

/**
 * Org identity keys (#56) must be reachable only from keys/orgs/, keyed by
 * sha256(orgName), isolated from the platform org key (keys/signing-key.json)
 * and from every contributor key (keys/contributors/) — and, unlike a
 * contributor's pseudonym, the org's actual name is never hashed or hidden;
 * only the on-disk filename is.
 */

function stubUnsigned(id) {
  return {
    id,
    zone: 'Downtown',
    ask: { category: 'shelter_bed', summary: 'stub org disclosure for signing test' },
    story: { raw: 'raw', shaped: 'raw' },
    consent: { advocateId: 'Example Shelter Fund', method: 'org self-disclosure', timestampISO: new Date().toISOString() },
    sourceClass: 'org_attested',
    status: 'answered',
  };
}

test('loadOrCreateOrgKeyPair writes an isolated, mode-0600 key under keys/orgs/, keyed by sha256(orgName)', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-org-'));
  try {
    const keys = await loadOrCreateOrgKeyPair('Example Shelter Fund', baseDir);
    assert.ok(keys.pubKey);

    const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('Example Shelter Fund'));
    const expectedHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const keyPath = join(baseDir, 'keys', 'orgs', `${expectedHash}.json`);
    assert.ok(existsSync(keyPath), 'key must be written to keys/orgs/<sha256(orgName)>.json');
    assert.ok(!existsSync(join(baseDir, 'keys', 'signing-key.json')), 'must never touch the platform org signing key');
    assert.ok(!existsSync(join(baseDir, 'keys', 'contributors')), 'must never touch the contributor keys directory');

    const mode = (await stat(keyPath)).mode & 0o777;
    assert.equal(mode, 0o600);

    // Idempotent: a second load for the same org name returns the same key, not a new one.
    const again = await loadOrCreateOrgKeyPair('Example Shelter Fund', baseDir);
    assert.equal(again.pubKey, keys.pubKey);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('two org names get isolated keys, distinct from each other, from a contributor key, and from the platform org key', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-org-'));
  try {
    const orgA = await loadOrCreateOrgKeyPair('Example Shelter Fund', baseDir);
    const orgB = await loadOrCreateOrgKeyPair('Downtown Mutual Aid', baseDir);
    const contributor = await loadOrCreateContributorKeyPair('alice', baseDir);
    const platform = await loadOrCreateKeyPair(baseDir);

    assert.notEqual(orgA.pubKey, orgB.pubKey);
    assert.notEqual(orgA.pubKey, contributor.pubKey);
    assert.notEqual(orgA.pubKey, platform.pubKey);

    const orgAEntry = await signEntryCose(stubUnsigned('stub_org_a'), orgA, { isOrgKey: false });
    assert.equal(await verifyCoseEntry(orgAEntry), true, 'org-signed entry must verify against its own pubKey');

    const asSignedBy = (entry, otherKeys) => ({
      ...entry,
      provenance: {
        ...entry.provenance,
        pubKey: otherKeys.pubKey,
        issuer: didKeyFromPublicJwk(otherKeys.publicJwk),
        verificationMethod: verificationMethodForDid(didKeyFromPublicJwk(otherKeys.publicJwk)),
      },
    });

    assert.equal(await verifyCoseEntry(asSignedBy(orgAEntry, orgB)), false, 'must not verify against another org\'s pubKey');
    assert.equal(await verifyCoseEntry(asSignedBy(orgAEntry, platform)), false, 'must not verify against the platform org pubKey');
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('the published org name is human-readable, not a derived hash', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-org-'));
  try {
    const keys = await loadOrCreateOrgKeyPair('Example Shelter Fund', baseDir);
    const entry = await signEntryCose(stubUnsigned('stub_org_readable'), keys, { isOrgKey: false });
    assert.equal(entry.consent.advocateId, 'Example Shelter Fund', 'consent.advocateId must carry the org name verbatim, never a pseudonym');
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
