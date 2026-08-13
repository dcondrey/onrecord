import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertNoPreciseLocation } from '../dist/schema.js';

/**
 * CLAUDE.md states the CLI verifier (src/schema.ts) and the browser verifier
 * (web/index.html) must never disagree, and that nothing in CI catches a
 * divergence between them. This file is that catch: both independently
 * implement the same "no precise location anywhere in the entry" scan, and
 * a real divergence between them (found and fixed in an earlier session) was
 * only caught by manually tampering an entry and comparing the two by hand.
 *
 * The browser's scanner is extracted directly from the shipped HTML rather
 * than hand-copied here — a copy risks silently drifting from the real code
 * the same way the original bug did.
 */
function loadBrowserScanner() {
  const htmlPath = fileURLToPath(new URL('../web/index.html', import.meta.url));
  const html = readFileSync(htmlPath, 'utf8');
  const match = html.match(/const FORBIDDEN_LOCATION_KEYS[\s\S]*?\nfunction findPreciseLocation\(value, path\)\{[\s\S]*?\n {2}return null;\n\}/);
  if (!match) {
    throw new Error(
      'Could not find FORBIDDEN_LOCATION_KEYS/findPreciseLocation in web/index.html. ' +
      'It moved or was renamed — update the regex above, do not skip this test.',
    );
  }
  const fn = new Function(`${match[0]}\nreturn findPreciseLocation;`)();
  return (entry) => fn(entry, '$');
}

function cliLeak(entry) {
  try {
    assertNoPreciseLocation(entry);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const BASE_ENTRY = {
  id: 'or_test_01',
  zone: 'Downtown',
  ask: { category: 'shelter_bed', summary: 'a bed for tonight' },
  story: { raw: 'raw note', shaped: 'shaped note' },
  consent: { advocateId: 'adv_1', method: 'verbal', timestampISO: '2026-01-01T00:00:00Z' },
  status: 'requested',
};

const FIXTURES = [
  {
    name: 'clean entry, no location fields',
    entry: structuredClone(BASE_ENTRY),
    expectLeak: false,
  },
  {
    name: 'top-level smuggled lat, isolated (no other forbidden key present)',
    entry: { ...structuredClone(BASE_ENTRY), smuggled: { lat: 32.71 } },
    expectLeak: true,
  },
  {
    name: 'top-level smuggled lng, isolated',
    entry: { ...structuredClone(BASE_ENTRY), smuggled: { lng: -117.16 } },
    expectLeak: true,
  },
  {
    name: 'nested smuggled address inside story',
    entry: (() => {
      const e = structuredClone(BASE_ENTRY);
      e.story.geo = { address: '123 Main St' };
      return e;
    })(),
    expectLeak: true,
  },
  {
    name: 'smuggled field inside an array',
    entry: (() => {
      const e = structuredClone(BASE_ENTRY);
      e.tags = ['ok', { coordinates: [32.71, -117.16] }];
      return e;
    })(),
    expectLeak: true,
  },
  {
    name: 'forbidden key in a different case (GPS)',
    entry: { ...structuredClone(BASE_ENTRY), GPS: '32.71,-117.16' },
    expectLeak: true,
  },
  {
    name: 'benign key containing a forbidden word as a substring, not an exact key',
    entry: { ...structuredClone(BASE_ENTRY), relatedTo: 'x', platform: 'ios' },
    expectLeak: false,
  },
];

test('CLI and browser precise-location scanners agree on every fixture', () => {
  const browserLeak = loadBrowserScanner();
  for (const f of FIXTURES) {
    const cli = cliLeak(f.entry) !== null;
    const browser = browserLeak(f.entry) !== null;
    assert.equal(cli, f.expectLeak, `CLI scanner wrong on: ${f.name}`);
    assert.equal(browser, f.expectLeak, `browser scanner wrong on: ${f.name}`);
    assert.equal(cli, browser, `CLI and browser disagree on: ${f.name}`);
  }
});

test('CLI and browser scanners agree on the real committed entries', () => {
  const entriesPath = fileURLToPath(new URL('../data/entries.json', import.meta.url));
  const entries = JSON.parse(readFileSync(entriesPath, 'utf8'));
  assert.ok(entries.length > 0, 'data/entries.json has no entries to check');
  const browserLeak = loadBrowserScanner();
  for (const entry of entries) {
    // Both verify.ts and the browser's verifyEntry() scan the FULL entry, provenance
    // included — matching that here, not stripping it, since a divergence in scope
    // between this test and the real call sites would make the test meaningless.
    assert.equal(cliLeak(entry), null, `CLI flagged a real committed entry: ${entry.id}`);
    assert.equal(browserLeak(entry), null, `browser flagged a real committed entry: ${entry.id}`);
  }
});
