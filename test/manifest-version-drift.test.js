import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../dist/schema.js';
import { MANIFEST_VERSION } from '../dist/sign.js';

/**
 * CONTRIBUTING.md says a change to canonicalize()'s field set or key order is a
 * re-signing event: bump MANIFEST_VERSION, regenerate with `npm run seed -- --force`,
 * confirm `npm run verify`, and update the browser verifier in web/index.html — but
 * nothing enforced that discipline. This snapshots canonicalize()'s exact byte output
 * for a fully-populated fixture (every optional field present, so a field being added,
 * removed, or reordered anywhere changes the string) alongside the MANIFEST_VERSION it
 * was captured against. A change to either without updating both here means someone
 * skipped a step in that process — this fails loudly instead of shipping quietly.
 *
 * If you are here because this genuinely failed after following the CONTRIBUTING.md
 * process (bumped MANIFEST_VERSION, regenerated, verified, updated the browser
 * verifier): update EXPECTED_MANIFEST_VERSION and EXPECTED_CANONICAL_JSON below to
 * match, in the same PR as the schema change.
 */

const FIXTURE = {
  id: 'or_fixture_01',
  zone: 'Downtown',
  ask: { category: 'shelter_bed', summary: 'a bed for tonight', amountUsd: 12 },
  story: { raw: 'raw text', shaped: 'shaped text' },
  consent: { advocateId: 'adv_1', method: 'verbal', timestampISO: '2026-01-01T00:00:00.000Z' },
  recovery: { scheme: 'claim-card/v1', verifierTag: 'deadbeef' },
  status: 'requested',
};

const EXPECTED_MANIFEST_VERSION = '1.0';
const EXPECTED_CANONICAL_JSON =
  '{"id":"or_fixture_01","zone":"Downtown","ask":{"category":"shelter_bed","summary":"a bed for tonight","amountUsd":12},"story":{"raw":"raw text","shaped":"shaped text"},"consent":{"advocateId":"adv_1","method":"verbal","timestampISO":"2026-01-01T00:00:00.000Z"},"recovery":{"scheme":"claim-card/v1","verifierTag":"deadbeef"},"status":"requested"}';

test('canonicalize()\'s field set/key order matches the version it was last signed under', () => {
  assert.equal(
    MANIFEST_VERSION,
    EXPECTED_MANIFEST_VERSION,
    'MANIFEST_VERSION changed without updating this test\'s expected value — if this was a deliberate schema change, update EXPECTED_MANIFEST_VERSION and EXPECTED_CANONICAL_JSON together; see CONTRIBUTING.md.',
  );
  assert.equal(
    canonicalize(FIXTURE),
    EXPECTED_CANONICAL_JSON,
    'canonicalize() output changed for the same input — a field was added, removed, or reordered without bumping MANIFEST_VERSION. Per CONTRIBUTING.md this is a re-signing event: bump MANIFEST_VERSION in src/sign.ts, regenerate with `npm run seed -- --force`, confirm `npm run verify`, update the browser verifier in web/index.html, then update this test.',
  );
});
