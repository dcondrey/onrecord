import test from 'node:test';
import assert from 'node:assert/strict';
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

test('self_attested_witness with no contributorPseudonym in context is rejected', () => {
  const e = entry({ sourceClass: 'self_attested_witness', consent: { advocateId: 'contrib_abc', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' } });
  assert.throws(() => validateUnsigned(e), ValidationError);
});

test('self_attested_witness with consent.advocateId not matching the contributor pseudonym is rejected', () => {
  const e = entry({
    sourceClass: 'self_attested_witness',
    consent: { advocateId: 'someone_else', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' },
  });
  assert.throws(
    () => validateUnsigned(e, { contributorPseudonym: 'contrib_abc' }),
    ValidationError,
    'a contributor must not be able to claim third-party advocate authority they do not have',
  );
});

test('self_attested_witness with consent.advocateId matching the contributor pseudonym is accepted', () => {
  const e = entry({
    sourceClass: 'self_attested_witness',
    consent: { advocateId: 'contrib_abc', method: 'self-report', timestampISO: '2026-01-01T00:00:00Z' },
  });
  assert.doesNotThrow(() => validateUnsigned(e, { contributorPseudonym: 'contrib_abc' }));
});
