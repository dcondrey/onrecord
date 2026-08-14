import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeFile } from 'node:fs/promises';
import { loadOrCreateKeyPair, signEntryCose, verifyCoseEntry } from '../dist/sign.js';
import { loadOrCreateContributorKeyPair } from '../dist/gateway/contributor-identity.js';
import { didKeyFromPublicJwk, buildDidDocument } from '../dist/did.js';
import { verifyFile } from '../dist/verify.js';

/**
 * ONRECORD_ISSUER_DID must apply only to the org key. Applying it to a
 * contributor key too would let a contributor-signed entry falsely claim the
 * org's issuer while actually signed by a different key entirely — the exact
 * regression this isOrgKey gate exists to prevent (caught while designing the
 * did:web migration, before it ever shipped).
 */

function stubUnsigned(id) {
  return {
    id,
    zone: 'Downtown',
    ask: { category: 'phone', summary: 'stub entry for did:web signing test' },
    story: { raw: 'raw', shaped: 'shaped' },
    consent: { advocateId: 'adv_test', method: 'verbal, in person, witnessed', timestampISO: new Date().toISOString() },
    status: 'requested',
  };
}

async function withIssuerEnv(value, fn) {
  const prior = process.env['ONRECORD_ISSUER_DID'];
  if (value === undefined) delete process.env['ONRECORD_ISSUER_DID'];
  else process.env['ONRECORD_ISSUER_DID'] = value;
  try {
    await fn();
  } finally {
    if (prior === undefined) delete process.env['ONRECORD_ISSUER_DID'];
    else process.env['ONRECORD_ISSUER_DID'] = prior;
  }
}

test('signEntryCose applies ONRECORD_ISSUER_DID for the org key (isOrgKey defaults true)', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-org-'));
  try {
    const keys = await loadOrCreateKeyPair(baseDir);
    await withIssuerEnv('did:web:example.org:onrecord', async () => {
      const entry = await signEntryCose(stubUnsigned('org_entry'), keys);
      assert.equal(entry.provenance.issuer, 'did:web:example.org:onrecord');
      assert.equal(entry.provenance.verificationMethod, 'did:web:example.org:onrecord#key-1');
    });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('signEntryCose ignores ONRECORD_ISSUER_DID for a contributor key (isOrgKey: false), even though the env var is globally set', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-contrib-'));
  try {
    const contributorKeys = await loadOrCreateContributorKeyPair('+15559990001', baseDir);
    const expectedIssuer = didKeyFromPublicJwk(contributorKeys.publicJwk);
    await withIssuerEnv('did:web:example.org:onrecord', async () => {
      const entry = await signEntryCose(stubUnsigned('contrib_entry'), contributorKeys, { isOrgKey: false });
      assert.equal(entry.provenance.issuer, expectedIssuer, 'a contributor-signed entry must never adopt the org did:web issuer');
      assert.ok(entry.provenance.issuer.startsWith('did:key:'), 'contributor entries stay self-certifying did:key');
    });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('signEntryCose falls back to did:key when ONRECORD_ISSUER_DID is unset, regardless of isOrgKey', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-fallback-'));
  try {
    const keys = await loadOrCreateKeyPair(baseDir);
    await withIssuerEnv(undefined, async () => {
      const entry = await signEntryCose(stubUnsigned('fallback_entry'), keys, { isOrgKey: true });
      assert.equal(entry.provenance.issuer, didKeyFromPublicJwk(keys.publicJwk));
    });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('a did:web-issued entry verifies against the correct pinned trust document and fails against a mismatched one', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-trust-'));
  try {
    const keys = await loadOrCreateKeyPair(baseDir);
    const otherKeys = await loadOrCreateKeyPair(await mkdtemp(join(tmpdir(), 'onrecord-other-')));
    await withIssuerEnv('did:web:example.org:onrecord', async () => {
      const entry = await signEntryCose(stubUnsigned('trust_entry'), keys);

      const correctDoc = buildDidDocument('did:web:example.org:onrecord', keys.publicJwk);
      assert.equal(await verifyCoseEntry(entry, correctDoc), true);

      const wrongKeyDoc = buildDidDocument('did:web:example.org:onrecord', otherKeys.publicJwk);
      assert.equal(await verifyCoseEntry(entry, wrongKeyDoc), false, 'a trust document pinning a different key must fail verification');

      assert.equal(await verifyCoseEntry(entry, undefined), true, 'omitting a trust document falls back to no pinning, not a hard failure');
    });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('verifyFile() reports issuerPinned=false for a did:web entry with no --did-doc, true once one is supplied', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'onrecord-report-'));
  try {
    const keys = await loadOrCreateKeyPair(baseDir);
    const entriesPath = join(baseDir, 'entries.json');
    await withIssuerEnv('did:web:example.org:onrecord', async () => {
      const entry = await signEntryCose(stubUnsigned('report_entry'), keys);
      await writeFile(entriesPath, JSON.stringify([entry]));

      const unpinned = await verifyFile(entriesPath);
      assert.equal(unpinned.entries[0].ok, true);
      assert.equal(unpinned.entries[0].issuerPinned, false, 'no --did-doc supplied, so the did:web issuer claim is unverified');

      const trustDocument = buildDidDocument('did:web:example.org:onrecord', keys.publicJwk);
      const pinned = await verifyFile(entriesPath, { trustDocument });
      assert.equal(pinned.entries[0].ok, true);
      assert.equal(pinned.entries[0].issuerPinned, true, 'a matching --did-doc pins the issuer identity');
    });
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
