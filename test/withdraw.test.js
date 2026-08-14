import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry } from '../dist/add.js';
import {
  signWithdrawRequest,
  verifyWithdrawRequest,
  withdrawEntry,
  withdrawSelfAttestedEntry,
  WithdrawError,
  WITHDRAWN_LOG_PATH,
} from '../dist/withdraw.js';
import { ENTRIES_PATH, MANIFESTS_DIR } from '../dist/seed.js';
import { deriveContributorPseudonym, loadOrCreateContributorKeyPair } from '../dist/gateway/contributor-identity.js';
import { loadOrCreateKeyPair } from '../dist/sign.js';

/**
 * withdrawEntry() deletes an entry from data/entries.json and its manifest,
 * at the requester's word alone, and logs only id/zone/category/timestamp
 * to data/withdrawn.json — never the raw or shaped story text. Runs against
 * a temp cwd via the same withTempCwd pattern as test/add.test.js, seeding
 * a real entry through addEntry() (with a stub transform) rather than
 * hand-building fixture JSON, so the withdrawal is exercised against the
 * actual shape addEntry produces.
 */

const BASE_INPUT = {
  raw: 'needs help finding a shelter bed for tonight',
  zone: 'Downtown',
  category: 'shelter_bed',
  advocateId: 'adv_test_01',
  consentMethod: 'verbal, in person, witnessed',
};

const stubTransform = async ({ raw }) => ({ shaped: `shaped: ${raw}`, model: 'stub-model', inputTokens: 1, outputTokens: 1 });

async function withTempCwd(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'onrecord-withdraw-test-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    await fn(dir);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('withdrawing an entry removes it from entries.json and deletes its manifest', async () => {
  await withTempCwd(async () => {
    const { entry } = await addEntry({ ...BASE_INPUT, id: 'or_withdraw_test' }, { transform: stubTransform });

    const result = await withdrawEntry(entry.id);
    assert.equal(result.entry.id, entry.id);
    assert.equal(result.manifestDeleted, true);

    const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf8'));
    assert.ok(!entries.some((e) => e.id === entry.id));

    await assert.rejects(readFile(join(MANIFESTS_DIR, `${entry.id}.json`), 'utf8'), /ENOENT/);
  });
});

test('withdrawal log records id/zone/category/timestamp only, never the story text', async () => {
  await withTempCwd(async () => {
    const { entry } = await addEntry({ ...BASE_INPUT, id: 'or_withdraw_log_test' }, { transform: stubTransform });
    await withdrawEntry(entry.id, 'requester asked to be removed');

    const log = JSON.parse(await readFile(WITHDRAWN_LOG_PATH, 'utf8'));
    const record = log.find((r) => r.id === entry.id);
    assert.ok(record);
    assert.equal(record.zone, entry.zone);
    assert.equal(record.category, entry.ask.category);
    assert.equal(record.reason, 'requester asked to be removed');
    assert.ok(record.withdrawnAtISO);

    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(entry.story.raw));
    assert.ok(!serialized.includes(entry.story.shaped));
  });
});

test('withdrawing twice fails the second time (no entry left to remove)', async () => {
  await withTempCwd(async () => {
    const { entry } = await addEntry({ ...BASE_INPUT, id: 'or_withdraw_twice_test' }, { transform: stubTransform });
    await withdrawEntry(entry.id);
    await assert.rejects(withdrawEntry(entry.id), WithdrawError);
  });
});

test('withdrawing an unknown id fails', async () => {
  await withTempCwd(async () => {
    await addEntry({ ...BASE_INPUT, id: 'or_withdraw_other' }, { transform: stubTransform });
    await assert.rejects(withdrawEntry('or_does_not_exist'), WithdrawError);
  });
});

test('an empty id is rejected', async () => {
  await withTempCwd(async () => {
    await assert.rejects(withdrawEntry('   '), WithdrawError);
  });
});

test('withdrawing when entries.json does not exist at all fails', async () => {
  await withTempCwd(async () => {
    await assert.rejects(withdrawEntry('or_anything'), WithdrawError);
  });
});

/**
 * Self-attested entries (#14/#28) have no advocate mediating, so withdrawal
 * is gated on a signature from the same contributor key that signed the
 * entry — see withdrawSelfAttestedEntry() in src/withdraw.ts.
 */

async function addSelfAttestedEntry(handle, overrides = {}) {
  const keys = await loadOrCreateContributorKeyPair(handle);
  const pseudonym = await deriveContributorPseudonym(handle);
  const { entry } = await addEntry(
    {
      ...BASE_INPUT,
      advocateId: pseudonym,
      consentMethod: 'self-attested via SMS',
      sourceClass: 'self_attested_witness',
      ...overrides,
    },
    { transform: stubTransform, keys, contributorPseudonym: pseudonym },
  );
  return entry;
}

test('withdrawing a self-attested entry with the signing contributor\'s own key succeeds', async () => {
  await withTempCwd(async () => {
    const entry = await addSelfAttestedEntry('+15551230001', { id: 'or_self_withdraw_ok' });

    const keys = await loadOrCreateContributorKeyPair('+15551230001');
    const signature = await signWithdrawRequest(entry.id, keys);
    const result = await withdrawSelfAttestedEntry(entry.id, signature);

    assert.equal(result.entry.id, entry.id);
    const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf8'));
    assert.ok(!entries.some((e) => e.id === entry.id));

    const log = JSON.parse(await readFile(WITHDRAWN_LOG_PATH, 'utf8'));
    assert.ok(log.some((r) => r.id === entry.id));
  });
});

test('withdrawing a self-attested entry signed by a different contributor\'s key is rejected', async () => {
  await withTempCwd(async () => {
    const entry = await addSelfAttestedEntry('+15551230002', { id: 'or_self_withdraw_wrong_key' });

    const otherKeys = await loadOrCreateContributorKeyPair('+15551230099');
    const signature = await signWithdrawRequest(entry.id, otherKeys);

    await assert.rejects(withdrawSelfAttestedEntry(entry.id, signature), WithdrawError);

    const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf8'));
    assert.ok(entries.some((e) => e.id === entry.id), 'entry must still be present after a rejected withdrawal');
  });
});

test('withdrawing a self-attested entry with a garbage signature is rejected', async () => {
  await withTempCwd(async () => {
    const entry = await addSelfAttestedEntry('+15551230003', { id: 'or_self_withdraw_garbage_sig' });
    await assert.rejects(withdrawSelfAttestedEntry(entry.id, 'not-a-real-signature'), WithdrawError);
  });
});

test('withdrawSelfAttestedEntry refuses an advocate-attested entry even with a valid-looking signature', async () => {
  await withTempCwd(async () => {
    const { entry } = await addEntry({ ...BASE_INPUT, id: 'or_advocate_via_self_withdraw' }, { transform: stubTransform });
    const keys = await loadOrCreateContributorKeyPair('+15551230004');
    const signature = await signWithdrawRequest(entry.id, keys);

    await assert.rejects(withdrawSelfAttestedEntry(entry.id, signature), WithdrawError);

    const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf8'));
    assert.ok(entries.some((e) => e.id === entry.id));
  });
});

test('withdrawSelfAttestedEntry refuses an entry with sourceClass self-attested but signerTier org (sourceClass alone is not enough)', async () => {
  await withTempCwd(async () => {
    const pseudonym = await deriveContributorPseudonym('+15551230006');
    // No `keys` override -> signed with the org key, but claiming a
    // self-attested sourceClass. This should never happen via addEntry's
    // real call sites, but the gate must not trust sourceClass alone.
    const { entry } = await addEntry(
      {
        ...BASE_INPUT,
        id: 'or_self_attested_org_signed',
        advocateId: pseudonym,
        consentMethod: 'self-attested via SMS',
        sourceClass: 'self_attested_witness',
      },
      { transform: stubTransform, contributorPseudonym: pseudonym },
    );
    assert.equal(entry.provenance.signerTier, 'org');

    // Sign with the SAME org key that actually signed the entry, so
    // verifyWithdrawRequest's signature check passes on a correct key — this
    // isolates the signerTier gate specifically, rather than incidentally
    // failing on a mismatched key regardless of whether that gate exists.
    const orgKeys = await loadOrCreateKeyPair();
    const signature = await signWithdrawRequest(entry.id, orgKeys);
    assert.equal(
      await verifyWithdrawRequest(entry, signature),
      true,
      'sanity check: the org key must actually verify against this entry, or this test is not isolating the signerTier gate',
    );
    await assert.rejects(withdrawSelfAttestedEntry(entry.id, signature), WithdrawError);

    const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf8'));
    assert.ok(entries.some((e) => e.id === entry.id));
  });
});

test('withdrawSelfAttestedEntry requires a non-empty signature', async () => {
  await withTempCwd(async () => {
    const entry = await addSelfAttestedEntry('+15551230005', { id: 'or_self_withdraw_no_sig' });
    await assert.rejects(withdrawSelfAttestedEntry(entry.id, ''), WithdrawError);
    await assert.rejects(withdrawSelfAttestedEntry(entry.id, '   '), WithdrawError);
  });
});
