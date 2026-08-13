import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * scripts/sync-web-data.mjs bakes data/entries.json into web/index.html's
 * V2_ENTRIES so the map stays a self-contained file. Nothing enforces that a
 * contributor who edits one re-runs that sync — this test is the enforcement:
 * if they drift, the map is silently showing stale data and this fails loudly
 * instead, pointing at `npm run web:sync`.
 */
test("web/index.html's embedded V2_ENTRIES exactly matches data/entries.json", () => {
  const htmlPath = fileURLToPath(new URL('../web/index.html', import.meta.url));
  const html = readFileSync(htmlPath, 'utf8');
  const match = html.match(/const V2_ENTRIES = \/\* ONRECORD_V2_DATA_START \*\/(.*?)\/\* ONRECORD_V2_DATA_END \*\//s);
  assert.ok(match, 'ONRECORD_V2_DATA_START/END markers not found in web/index.html — they moved or were renamed; update the regex above, do not skip this test');
  const embedded = JSON.parse(match[1].trim());

  const entriesPath = fileURLToPath(new URL('../data/entries.json', import.meta.url));
  const onDisk = JSON.parse(readFileSync(entriesPath, 'utf8'));

  assert.deepEqual(
    embedded,
    onDisk,
    'web/index.html\'s embedded entries do not match data/entries.json — run `npm run web:sync` and commit the result',
  );
});
