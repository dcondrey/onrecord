import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalize, validateUnsigned, ValidationError } from '../dist/schema.js';

/**
 * sourceClass discriminator (#16, part of #14). 'self_attested_witness' means a
 * contributor is vouching for their own account, not someone else's — so
 * validateUnsigned() must refuse to let consent.advocateId name a different
 * advocate than the contributor's own gateway pseudonym. Absent (or
 * 'advocate_attested') entries are unaffected: this is a new gate, not a
 * tightening of the existing consent requirement.
 */

const BASE = {
  id: 'or_sourceclass_01',
  zone: 'Downtown',
  ask: { category: 'shelter_bed', summary: 'a bed for tonight' },
  story: { raw: 'raw note', shaped: 'shaped note' },
  status: 'requested',
};

function entry(overrides) {
  return {
    ...structuredClone(BASE),
    consent: { advocateId: 'adv_1', method: 'verbal', timestampISO: '2026-01-01T00:00:00Z' },
    ...overrides,
  };
}

test('sourceClass is omitted from canonicalize() when absent, unchanged from prior byte output', () => {
  const e = entry({});
  assert.doesNotMatch(canonicalize(e), /sourceClass/);
});

test('advocate_attested (and absent) entries validate with no contributor context required', () => {
  assert.doesNotThrow(() => validateUnsigned(entry({})));
  assert.doesNotThrow(() => validateUnsigned(entry({ sourceClass: 'advocate_attested' })));
});

test('a bogus sourceClass value is rejected, not silently accepted', () => {
  const e = entry({ sourceClass: 'self_attested_witnesses' });
  assert.throws(() => validateUnsigned(e), ValidationError);
});

test('self_attested_witness with no assertingIdentity in context is rejected', () => {
  const e = entry({ sourceClass: 'self_attested_witness', consent: { advocateId: 'contrib_abc', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' } });
  assert.throws(() => validateUnsigned(e), ValidationError);
});

test('self_attested_witness with consent.advocateId not matching the contributor pseudonym is rejected', () => {
  const e = entry({
    sourceClass: 'self_attested_witness',
    consent: { advocateId: 'someone_else', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' },
  });
  assert.throws(
    () => validateUnsigned(e, { assertingIdentity: 'contrib_abc' }),
    ValidationError,
    'a contributor must not be able to claim third-party advocate authority they do not have',
  );
});

test('self_attested_witness with consent.advocateId matching the contributor pseudonym is accepted', () => {
  const e = entry({
    sourceClass: 'self_attested_witness',
    consent: { advocateId: 'contrib_abc', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' },
  });
  assert.doesNotThrow(() => validateUnsigned(e, { assertingIdentity: 'contrib_abc' }));
});

/**
 * self_attested_personal (#28, part of #14): a person publishing their own story/ask
 * under their own contributor identity, distinct from self_attested_witness's
 * third-party-observation case, but gated by the same self-consent mechanism.
 */

test('self_attested_personal with no assertingIdentity in context is rejected', () => {
  const e = entry({ sourceClass: 'self_attested_personal', consent: { advocateId: 'contrib_abc', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' } });
  assert.throws(() => validateUnsigned(e), ValidationError);
});

test('self_attested_personal with consent.advocateId not matching the contributor pseudonym is rejected', () => {
  const e = entry({
    sourceClass: 'self_attested_personal',
    consent: { advocateId: 'someone_else', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' },
  });
  assert.throws(
    () => validateUnsigned(e, { assertingIdentity: 'contrib_abc' }),
    ValidationError,
    'a contributor must not be able to claim third-party advocate authority they do not have',
  );
});

test('self_attested_personal with consent.advocateId matching the contributor pseudonym is accepted', () => {
  const e = entry({
    sourceClass: 'self_attested_personal',
    consent: { advocateId: 'contrib_abc', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' },
  });
  assert.doesNotThrow(() => validateUnsigned(e, { assertingIdentity: 'contrib_abc' }));
});

/**
 * org_attested (#55, part of #54): an org vouching for its own spending disclosure,
 * gated the same self-consent way as self_attested_witness/personal, but the "own
 * name" here is #56's plaintext org identity, never a pseudonym.
 */

test('org_attested with no org identity in context is rejected', () => {
  const e = entry({ sourceClass: 'org_attested', consent: { advocateId: 'Example Shelter Fund', method: 'org self-disclosure', timestampISO: '2026-01-01T00:00:00Z' } });
  assert.throws(() => validateUnsigned(e), ValidationError);
});

test('org_attested with consent.advocateId not matching the signing org identity is rejected', () => {
  const e = entry({
    sourceClass: 'org_attested',
    consent: { advocateId: 'Some Other Org', method: 'org self-disclosure', timestampISO: '2026-01-01T00:00:00Z' },
  });
  assert.throws(
    () => validateUnsigned(e, { assertingIdentity: 'Example Shelter Fund' }),
    ValidationError,
    'an org must not be able to publish a disclosure under a different org\'s name than the one that signed it',
  );
});

test('org_attested with consent.advocateId matching the signing org identity is accepted', () => {
  const e = entry({
    sourceClass: 'org_attested',
    consent: { advocateId: 'Example Shelter Fund', method: 'org self-disclosure', timestampISO: '2026-01-01T00:00:00Z' },
  });
  assert.doesNotThrow(() => validateUnsigned(e, { assertingIdentity: 'Example Shelter Fund' }));
});

/**
 * web/index.html's Street Pulse tier (#18) is a deliberately lower-trust rendering
 * path gated on a strict-equal check against the 'self_attested_witness' literal
 * (see the comment above `const witness = ...`). self_attested_personal (#28) must
 * never be pulled into that gate: it renders with standard marker treatment. Nor
 * must org_attested (#55), which gets its own distinct 'Org Disclosure' badge
 * (.orgbadge), never the Street Pulse framing. This greps the shipped source rather
 * than driving a browser, so a future edit that widens the gate (e.g. to an array
 * including 'self_attested_personal'/'org_attested', or a truthy `e.sourceClass`
 * check) fails loudly here instead of silently demoting a person's own published
 * story, or an org's financial disclosure, to the unreviewed-crowd-signal tier.
 */
test("web/index.html's sourceClass equality gates match only self_attested_witness and org_attested, and Street Pulse never gates on org_attested", () => {
  const html = readFileSync(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8');
  const gates = [...new Set([...html.matchAll(/sourceClass\s*===\s*"([a-z_]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(
    gates.slice().sort(),
    ['org_attested', 'self_attested_witness'],
    'a sourceClass equality gate in web/index.html matches something other than self_attested_witness/org_attested',
  );
  const pulsebadgeLines = html.split('\n').filter((line) => line.includes('pulsebadge'));
  assert.deepEqual(
    pulsebadgeLines.filter((line) => line.includes('org_attested')),
    [],
    'Street Pulse (.pulsebadge) must never render for org_attested — that badge is .orgbadge, a distinct class',
  );
});

/**
 * #30: self_reported_count entries are a corroborating signal shown alongside
 * DOWNTOWN_UNSHELTERED's DSDP/H-Hub series (downtownDetailHTML(), web/index.html)
 * but must never be folded into it. Statically checks that no line computing the
 * self-reported list also touches the DSDP series' own variables, so a future
 * edit that merges the two fails here instead of silently corrupting the series.
 */
test("web/index.html's self-reported street counts (#30) are never combined with DOWNTOWN_UNSHELTERED's series", () => {
  const html = readFileSync(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8');
  const m = html.match(/function downtownDetailHTML\(\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'downtownDetailHTML() moved or was renamed in web/index.html — update this test, do not skip it');
  const dsdpSeriesTerms = ['uVals', 'uMonths', 'uAvgLast3', 'uYoyPct', 'overlapUnsheltered', 'u.counts'];
  const badLines = m[0].split('\n').filter((line) => line.includes('selfReported') && dsdpSeriesTerms.some((t) => line.includes(t)));
  assert.deepEqual(
    badLines,
    [],
    'a line computing selfReported/selfReportedHTML also references the DOWNTOWN_UNSHELTERED series — it must stay a separate, never-summed signal',
  );
});

/**
 * #18 regression guard: refreshMarkers() rewrites aria-label unconditionally on
 * every call (~20 call sites) and previously dropped buildMap()'s Street Pulse
 * suffix, silently reverting the accessible name on the first refresh after
 * boot. No jsdom in this repo, so this is a static check instead.
 */
test('web/index.html\'s refreshMarkers() reproduces the Street Pulse aria-label suffix, not just buildMap()', () => {
  const html = readFileSync(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8');
  const buildMapAria = html.match(/const ariaTail = \(witness\?[^;]+;/);
  assert.ok(buildMapAria, 'buildMap()\'s ariaTail computation moved or was renamed — update this test, do not skip it');
  const refreshFn = html.match(/function refreshMarkers\(\)\{[\s\S]*?\n\}/);
  assert.ok(refreshFn, 'refreshMarkers() moved or was renamed in web/index.html — update this test, do not skip it');
  const ariaLine = refreshFn[0].split('\n').find((line) => line.includes('setAttribute("aria-label"'));
  assert.ok(ariaLine, 'refreshMarkers() no longer sets aria-label directly — if a helper now does it, point this test at that helper instead');
  assert.match(
    ariaLine,
    /witness/,
    'refreshMarkers()\'s aria-label line does not reference the witness/sourceClass suffix that buildMap() sets — a filter change or seal check would silently clobber the Street Pulse accessible name back to generic text',
  );
});
