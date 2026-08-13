import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { exportRecordBundle } from '../dist/export.js';

const run = promisify(execFile);

/**
 * export.ts's own VERIFY.txt, embedded in every bundle, tells a reader to run
 * `on-record verify entry.json --did-doc did.json`. Nothing ran that until
 * this test — it turned out to be broken: entry.json is a single record, not
 * an array, and verifyFile() required an array (fixed in verify.ts alongside
 * this test). This round-trips a real committed entry through export, unzips
 * it, and runs the literal command the bundle tells a reader to run.
 */
test('a real exported bundle verifies with the exact command its own VERIFY.txt gives', async () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const entriesPath = join(repoRoot, 'data', 'entries.json');
  const [entry] = JSON.parse(await readFile(entriesPath, 'utf8'));
  assert.ok(entry, 'data/entries.json has no entries to export');

  const dir = await mkdtemp(join(tmpdir(), 'onrecord-export-test-'));
  try {
    const zipPath = join(dir, 'bundle.zip');
    const result = await exportRecordBundle(entry, zipPath, repoRoot);

    const zip = await readFile(result.zipPath);
    const files = unzipSync(zip);
    assert.ok(files['entry.json'], 'bundle is missing entry.json');
    assert.ok(files['did.json'], 'bundle is missing did.json');
    assert.ok(files['VERIFY.txt'], 'bundle is missing VERIFY.txt');

    const verifyTxt = Buffer.from(files['VERIFY.txt']).toString('utf8');
    assert.match(verifyTxt, /on-record verify entry\.json --did-doc did\.json/);

    const entryPath = join(dir, 'entry.json');
    const didPath = join(dir, 'did.json');
    await writeFile(entryPath, files['entry.json']);
    await writeFile(didPath, files['did.json']);

    const cliPath = join(repoRoot, 'dist', 'cli.js');
    const { stdout } = await run(process.execPath, [cliPath, 'verify', 'entry.json', '--did-doc', 'did.json', '--json'], {
      cwd: dir,
    });
    const report = JSON.parse(stdout);
    assert.equal(report.total, 1);
    assert.equal(report.verified, 1);
    assert.equal(report.failed, 0);
    assert.equal(report.entries[0].id, entry.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
