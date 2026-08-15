import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { reportSpending } from '../dist/report-spending.js';
import { AddEntryError } from '../dist/add.js';

/**
 * reportSpending() (#57) is addEntry() wrapped with #56's isolated org identity
 * key, sourceClass 'org_attested', and a synthetic org_spending_report
 * domainPayload — the same reuse pattern the SMS gateway (src/gateway/sms.ts)
 * uses for contributor keys. Runs against a temp cwd so no real repo file
 * (keys/, data/) is touched.
 */

const BASE_INPUT = {
  orgName: 'Example Shelter Fund',
  zone: 'La Mesa',
  category: 'shelter_bed',
  amount: '5000',
  period: '2026-Q3',
  disclosureText: 'Example Shelter Fund disclosed $5,000 in shelter_bed spending in La Mesa for 2026-Q3.',
};

async function withTempCwd(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'onrecord-report-spending-test-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    await fn(dir);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('a well-formed disclosure publishes as org_attested, signed under an isolated org key, never the platform key', async () => {
  await withTempCwd(async (dir) => {
    const output = await reportSpending(BASE_INPUT);
    assert.equal(output.entry.sourceClass, 'org_attested');
    assert.equal(output.entry.consent.advocateId, 'Example Shelter Fund');
    assert.equal(output.entry.provenance.signerTier, 'org_identity');
    assert.equal(output.entry.domainPayload.kind, 'org_spending_report');
    assert.deepEqual(output.entry.domainPayload.data, {
      orgName: 'Example Shelter Fund',
      zone: 'La Mesa',
      category: 'shelter_bed',
      amountUsd: 5000,
      period: '2026-Q3',
      reportedAtISO: output.entry.domainPayload.data.reportedAtISO,
    });
    assert.ok(!existsSync(join(dir, 'keys', 'signing-key.json')), 'must never touch the platform signing key');
    assert.ok(existsSync(join(dir, 'keys', 'orgs')), 'must write under the isolated keys/orgs/ directory');
  });
});

test('the disclosure text is published unshaped (org_attested skips the Claude transform)', async () => {
  await withTempCwd(async () => {
    const output = await reportSpending(BASE_INPUT);
    assert.equal(output.entry.story.raw, BASE_INPUT.disclosureText);
    assert.equal(output.entry.story.shaped, BASE_INPUT.disclosureText);
    assert.equal(output.transformResult.model, 'none (org_attested entries skip the transform)');
  });
});

test('status defaults to answered, never the unmet-ask default', async () => {
  await withTempCwd(async () => {
    const output = await reportSpending(BASE_INPUT);
    assert.equal(output.entry.status, 'answered');
  });
});

test('a missing org name is rejected', async () => {
  await withTempCwd(async () => {
    await assert.rejects(reportSpending({ ...BASE_INPUT, orgName: '' }), AddEntryError);
  });
});

test('a missing period is rejected', async () => {
  await withTempCwd(async () => {
    await assert.rejects(reportSpending({ ...BASE_INPUT, period: '' }), AddEntryError);
  });
});

test('a missing disclosure text is rejected', async () => {
  await withTempCwd(async () => {
    await assert.rejects(reportSpending({ ...BASE_INPUT, disclosureText: '' }), AddEntryError);
  });
});

test('an unknown zone is rejected', async () => {
  await withTempCwd(async () => {
    await assert.rejects(reportSpending({ ...BASE_INPUT, zone: 'Nowhere' }), AddEntryError);
  });
});

test('a negative amount is rejected', async () => {
  await withTempCwd(async () => {
    await assert.rejects(reportSpending({ ...BASE_INPUT, amount: '-5' }), AddEntryError);
  });
});

test('two different org names get isolated keys, and the same org name reuses its key across two disclosures', async () => {
  await withTempCwd(async () => {
    const a = await reportSpending({ ...BASE_INPUT, id: 'or_report_a' });
    const b = await reportSpending({ ...BASE_INPUT, id: 'or_report_b', period: '2026-Q4' });
    const c = await reportSpending({ ...BASE_INPUT, id: 'or_report_c', orgName: 'Other Org' });

    assert.equal(a.entry.provenance.pubKey, b.entry.provenance.pubKey, 'same org name must reuse the same isolated key');
    assert.notEqual(a.entry.provenance.pubKey, c.entry.provenance.pubKey, 'a different org name must get a distinct isolated key');

    const entries = JSON.parse(await readFile(join(process.cwd(), 'data', 'entries.json'), 'utf8'));
    assert.equal(entries.length, 3);
  });
});
