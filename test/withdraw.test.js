import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry } from '../dist/add.js';
import { withdrawEntry, WithdrawError, WITHDRAWN_LOG_PATH } from '../dist/withdraw.js';
import { ENTRIES_PATH, MANIFESTS_DIR } from '../dist/seed.js';

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
