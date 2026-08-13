import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyFile } from '../dist/verify.js';

/**
 * verifyCoseEntry() can throw on malformed input (bad base64, corrupted CBOR)
 * instead of returning false. Without a try/catch around it, one corrupted v2
 * entry would abort verifyFile()'s whole loop — the exact scenario this tool
 * exists to report cleanly, not crash on.
 */
test('verifyFile() reports a corrupted v2 pubKey as a clean FAIL, not a thrown exception', async () => {
  const entriesPath = fileURLToPath(new URL('../data/entries.json', import.meta.url));
  const entries = JSON.parse(readFileSync(entriesPath, 'utf8'));
  const [real] = entries;
  assert.equal(real.provenance.protocolVersion, '2.0', 'fixture assumes a protocol-v2 entry');

  const corrupted = structuredClone(real);
  corrupted.provenance.pubKey = 'not-valid-base64-spki-!!!';

  const dir = await mkdtemp(join(tmpdir(), 'onrecord-verify-crash-'));
  const path = join(dir, 'entries.json');
  try {
    await writeFile(path, JSON.stringify([corrupted]));

    await assert.doesNotReject(async () => {
      const report = await verifyFile(path);
      assert.equal(report.total, 1);
      assert.equal(report.failed, 1);
      assert.equal(report.verified, 0);
      assert.equal(report.entries[0].ok, false);
      assert.ok(report.entries[0].diagnosis, 'a failed entry should carry a diagnosis');
    }, 'verifyFile() must not throw on a corrupted v2 entry');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
