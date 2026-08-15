import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * #59: needs-vs-spending gap dashboard. Explicitly a gap-surfacing tool, not
 * a scorecard — docs/limitations.md's non-goal against a punitive per-org
 * ranking. The load-bearing guarantee is that renderFundingGap()/fundGapRow()
 * never reference orgName (or any other per-entry identifying field) —
 * checked by extracting the real function bodies out of the shipped HTML,
 * not by re-deriving the aggregation logic by hand.
 */

function loadHtml() {
  return readFileSync(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8');
}

function extractFn(html, name) {
  const m = html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`${name}() moved or was renamed in web/index.html — update this test, do not skip it`);
  return m[0];
}

test("web/index.html declares fundGapRow(), not a second gapRow() — a name collision with the Trends tab's existing gapRow(r, max) silently shadows one of them (later declaration wins) and crashes the loser on its first real call", () => {
  const html = loadHtml();
  const declarations = [...html.matchAll(/function (gapRow|fundGapRow)\(/g)].map((m) => m[1]);
  assert.deepEqual(
    declarations.sort(),
    ['fundGapRow', 'gapRow'],
    'exactly one gapRow() (Trends tab) and one fundGapRow() (#59) must be declared — a second gapRow() reintroduces the shadowing crash',
  );
});

test('renderFundingGap()/fundGapRow() never reference orgName or otherwise attribute a figure to a single named org', () => {
  const html = loadHtml();
  const renderFundingGap = extractFn(html, 'renderFundingGap');
  const fundGapRow = extractFn(html, 'fundGapRow');
  for (const [name, src] of [['renderFundingGap', renderFundingGap], ['fundGapRow', fundGapRow]]) {
    assert.doesNotMatch(src, /orgName/, `${name}() must never reference domainPayload.data.orgName — the dashboard aggregate view must not attribute spending to a single org`);
    assert.doesNotMatch(src, /advocateId/, `${name}() must never reference consent.advocateId — for an org_attested entry that IS the org's name`);
  }
});

test("renderFundingGap()'s copy frames this as a gap-surfacing view, not a ranking or scorecard", () => {
  const html = loadHtml();
  const renderFundingGap = extractFn(html, 'renderFundingGap');
  assert.match(renderFundingGap, /not a ranking/i, 'renderFundingGap() must explicitly disclaim ranking/scorecard framing, matching the non-goal in #59 and docs/limitations.md');
});

const FIXTURE_DISCLOSURE = { withdrawn: false, pendingReview: false, prov: { ok: true } };

// Extracts the real cell-aggregation block out of renderFundingGap() itself (the
// same extract-and-eval pattern test/verify-cose.test.js uses for the browser
// verifier), rather than hand-copying the logic — a hand-copy can't fail when the
// real aggregation drifts, which is exactly how two real bugs shipped silently
// before (see CLAUDE.md's note on verify-parity.test.js/verify-cose.test.js).
function extractCellAggregation(html) {
  // Anchored on the unique function signature, not the "const live = ASK_ENTRIES.filter"
  // line alone — renderDash() has its own identical-looking line, and a non-greedy match
  // starting there would swallow everything up to (and including) renderDash's own body,
  // barRow(), and the start of renderFundingGap() before finally reaching the real end anchor.
  const m = html.match(
    /function renderFundingGap\(\)\{[\s\S]*?disclosures\.forEach\(e => \{ cell\(e\.zone, e\.ask\.category\)\.spending \+= \(e\.ask\.amountUsd \|\| 0\); \}\);/,
  );
  if (!m) throw new Error('renderFundingGap()\'s cell-aggregation block moved or was renamed in web/index.html — update this test, do not skip it');
  // Strip the leading function signature and the host lookup — DOM access, not part of
  // the aggregation logic under test, and unavailable in this test's Node context.
  return m[0]
    .replace(/^function renderFundingGap\(\)\{/, '')
    .replace(/^\s*const host = document\.getElementById\("panel-fundgap"\);\n/m, '');
}

function computeGapCells(askEntries, orgSpendingEntries) {
  const fn = new Function(
    'ASK_ENTRIES',
    'ORG_SPENDING_ENTRIES',
    `${extractCellAggregation(loadHtml())}\nreturn cells;`,
  );
  return fn(askEntries, orgSpendingEntries);
}

test('a zone/category with asks but zero disclosed spending surfaces as a visible gap cell', () => {
  const cells = computeGapCells(
    [
      { zone: 'Downtown', ask: { category: 'shelter_bed', amountUsd: 0 }, withdrawn: false, pendingReview: false, prov: { ok: true } },
      { zone: 'Downtown', ask: { category: 'shelter_bed', amountUsd: 0 }, withdrawn: false, pendingReview: false, prov: { ok: true } },
    ],
    [],
  );
  const cell = cells['Downtown|shelter_bed'];
  assert.equal(cell.askCount, 2);
  assert.equal(cell.spending, 0, 'no org_spending_report entries in this zone/category means zero disclosed spending, not an absent cell');
});

test('a zone/category with disclosed spending but no matching asks still surfaces (spending-only cell)', () => {
  const cells = computeGapCells([], [{ zone: 'La Mesa', ask: { category: 'shelter_bed', amountUsd: 180000 }, ...FIXTURE_DISCLOSURE }]);
  const cell = cells['La Mesa|shelter_bed'];
  assert.equal(cell.askCount, 0);
  assert.equal(cell.spending, 180000);
});

test('multiple disclosures in the same zone/category sum, across reported periods', () => {
  const cells = computeGapCells(
    [],
    [
      { zone: 'La Mesa', ask: { category: 'shelter_bed', amountUsd: 180000 }, ...FIXTURE_DISCLOSURE },
      { zone: 'La Mesa', ask: { category: 'shelter_bed', amountUsd: 30000 }, ...FIXTURE_DISCLOSURE },
    ],
  );
  assert.equal(cells['La Mesa|shelter_bed'].spending, 210000);
});

test('withdrawn or pending-review asks are excluded from the ask side of the gap, matching the Accountability dashboard pool', () => {
  const cells = computeGapCells(
    [
      { zone: 'Downtown', ask: { category: 'phone', amountUsd: 10 }, withdrawn: true, pendingReview: false, prov: { ok: true } },
      { zone: 'Downtown', ask: { category: 'phone', amountUsd: 20 }, withdrawn: false, pendingReview: true, prov: { ok: true } },
    ],
    [],
  );
  assert.equal(cells['Downtown|phone'], undefined, 'a withdrawn/pending ask must not create a gap cell on its own');
});

test('a withdrawn, pending-review, or seal-broken disclosure is excluded from the spending side of the gap, mirroring the ask side', () => {
  const base = { zone: 'Downtown', ask: { category: 'phone', amountUsd: 500 } };
  const cells = computeGapCells(
    [],
    [
      { ...base, withdrawn: true, pendingReview: false, prov: { ok: true } },
      { ...base, withdrawn: false, pendingReview: true, prov: { ok: true } },
      { ...base, withdrawn: false, pendingReview: false, prov: { ok: false } },
    ],
  );
  assert.equal(cells['Downtown|phone'], undefined, 'a disclosure that is withdrawn, pending review, or fails its own signature check must not surface as disclosed spending');
});
