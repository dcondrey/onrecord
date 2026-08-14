import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { handleSmsWebhook, PENDING_REVIEW_PATH } from '../dist/gateway/sms.js';
import { ENTRIES_PATH } from '../dist/seed.js';

/**
 * SMS intake gateway (#17, part of #14): a contributor-signed, held-for-review
 * path distinct from /api/add's advocate-mediated one (test/intake-server.test.js).
 * Uses handleSmsWebhook's injectable transform (mirroring addEntry()'s in
 * test/add.test.js) so this runs with no ANTHROPIC_API_KEY, network call, or
 * repo file touched — real req/res objects are unnecessary too; readBody only
 * needs an async-iterable of Buffers plus a headers map, and the handler only
 * needs writeHead/end.
 */

const stubTransform = async ({ raw }) => ({ shaped: `shaped: ${raw}`, model: 'stub-model', inputTokens: 1, outputTokens: 1 });

function mockReq(body, headers = {}) {
  const req = Readable.from([Buffer.from(body, 'utf8')]);
  req.headers = { 'content-type': 'application/x-www-form-urlencoded', ...headers };
  return req;
}

function mockRes() {
  return {
    statusCode: undefined,
    responseHeaders: undefined,
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.responseHeaders = headers;
      return this;
    },
    end(chunk) {
      if (chunk) this.body += chunk;
      return this;
    },
  };
}

async function withTempCwd(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'onrecord-sms-test-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    await fn(dir);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('a submission lands in data/pending-review.json, signed under a contributor key, and data/entries.json is untouched', async () => {
  await withTempCwd(async () => {
    const req = mockReq('Body=Father Joes full, no dogs&From=%2B15551234567');
    const res = mockRes();
    await handleSmsWebhook(req, res, { transform: stubTransform });

    assert.equal(res.statusCode, 200);
    assert.equal(existsSync(ENTRIES_PATH), false, 'data/entries.json must never be written by the SMS gateway');
    assert.equal(existsSync('data/did.json'), false, 'a contributor-signed submission must never write the org did.json');

    const pending = JSON.parse(await readFile(PENDING_REVIEW_PATH, 'utf8'));
    assert.equal(pending.length, 1);
    const { entry } = pending[0];
    assert.equal(entry.sourceClass, 'self_attested_witness');
    assert.equal(entry.consent.method, 'self-attested via SMS');
    assert.equal(entry.consent.advocateId, pending[0].entry.consent.advocateId);
    assert.match(entry.consent.advocateId, /^contrib_[0-9a-f]{16}$/, 'advocateId must be the derived pseudonym, not the raw From number');
    assert.equal(entry.provenance.signerTier, 'contributor');
    assert.equal(entry.story.raw, 'Father Joes full, no dogs');
  });
});

test('repeat submissions from the same From reuse the same contributor key (same signer, same pseudonym)', async () => {
  await withTempCwd(async () => {
    const first = mockReq('Body=first report&From=%2B15551234567');
    await handleSmsWebhook(first, mockRes(), { transform: stubTransform });
    const second = mockReq('Body=second report&From=%2B15551234567');
    await handleSmsWebhook(second, mockRes(), { transform: stubTransform });

    const pending = JSON.parse(await readFile(PENDING_REVIEW_PATH, 'utf8'));
    assert.equal(pending.length, 2);
    assert.equal(pending[0].entry.consent.advocateId, pending[1].entry.consent.advocateId);
    assert.equal(pending[0].entry.provenance.pubKey, pending[1].entry.provenance.pubKey);
  });
});

test('a different From gets a distinct contributor key and pseudonym', async () => {
  await withTempCwd(async () => {
    const a = mockReq('Body=report a&From=%2B15551234567');
    await handleSmsWebhook(a, mockRes(), { transform: stubTransform });
    const b = mockReq('Body=report b&From=%2B15557654321');
    await handleSmsWebhook(b, mockRes(), { transform: stubTransform });

    const pending = JSON.parse(await readFile(PENDING_REVIEW_PATH, 'utf8'));
    assert.notEqual(pending[0].entry.consent.advocateId, pending[1].entry.consent.advocateId);
    assert.notEqual(pending[0].entry.provenance.pubKey, pending[1].entry.provenance.pubKey);
  });
});

test('missing Body is rejected with 400 and nothing is written', async () => {
  await withTempCwd(async () => {
    const req = mockReq('From=%2B15551234567');
    const res = mockRes();
    await handleSmsWebhook(req, res, { transform: stubTransform });
    assert.equal(res.statusCode, 400);
    assert.equal(existsSync(PENDING_REVIEW_PATH), false);
  });
});

test('missing From is rejected with 400 and nothing is written', async () => {
  await withTempCwd(async () => {
    const req = mockReq('Body=hello');
    const res = mockRes();
    await handleSmsWebhook(req, res, { transform: stubTransform });
    assert.equal(res.statusCode, 400);
    assert.equal(existsSync(PENDING_REVIEW_PATH), false);
  });
});

test('wrong content-type is rejected with 415', async () => {
  await withTempCwd(async () => {
    const req = mockReq('{}', { 'content-type': 'application/json' });
    const res = mockRes();
    await handleSmsWebhook(req, res, { transform: stubTransform });
    assert.equal(res.statusCode, 415);
  });
});

test('Zone/Category fields, when supplied and valid, override the defaults', async () => {
  await withTempCwd(async () => {
    const req = mockReq('Body=need id docs&From=%2B15551234567&Zone=Hillcrest&Category=id_documents');
    await handleSmsWebhook(req, mockRes(), { transform: stubTransform });
    const pending = JSON.parse(await readFile(PENDING_REVIEW_PATH, 'utf8'));
    assert.equal(pending[0].entry.zone, 'Hillcrest');
    assert.equal(pending[0].entry.ask.category, 'id_documents');
  });
});

test('an invalid Zone/Category field falls back to the default rather than failing', async () => {
  await withTempCwd(async () => {
    const req = mockReq('Body=need id docs&From=%2B15551234567&Zone=Nowhere&Category=bogus');
    const res = mockRes();
    await handleSmsWebhook(req, res, { transform: stubTransform });
    assert.equal(res.statusCode, 200);
    const pending = JSON.parse(await readFile(PENDING_REVIEW_PATH, 'utf8'));
    assert.equal(pending[0].entry.zone, 'Downtown');
    assert.equal(pending[0].entry.ask.category, 'shelter_bed');
  });
});

test('two concurrent submissions both land — enqueueIntake serializes the read-modify-write instead of one clobbering the other', async () => {
  await withTempCwd(async () => {
    // Delays past the point where a naive read-modify-write would race: both
    // handlers read data/pending-review.json before either has written it back,
    // which is exactly the double-click scenario intake-queue.ts exists to close.
    const slowTransform = async ({ raw }) => {
      await new Promise((r) => setTimeout(r, 10));
      return { shaped: `shaped: ${raw}`, model: 'stub-model', inputTokens: 1, outputTokens: 1 };
    };
    const reqA = mockReq('Body=report a&From=%2B15551234567');
    const reqB = mockReq('Body=report b&From=%2B15557654321');
    await Promise.all([
      handleSmsWebhook(reqA, mockRes(), { transform: slowTransform }),
      handleSmsWebhook(reqB, mockRes(), { transform: slowTransform }),
    ]);

    const pending = JSON.parse(await readFile(PENDING_REVIEW_PATH, 'utf8'));
    assert.equal(pending.length, 2, 'both concurrent submissions must be present, not one dropped');
    const rawTexts = pending.map((p) => p.entry.story.raw).sort();
    assert.deepEqual(rawTexts, ['report a', 'report b']);
  });
});
