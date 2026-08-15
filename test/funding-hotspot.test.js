import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * #58: zone-aggregated funding hotspot choropleth. Extracts the real
 * zoneSpending/maxZoneSpending aggregation straight out of web/index.html
 * (same extract-and-eval pattern test/verify-cose.test.js uses for the
 * browser verifier) rather than re-deriving it by hand, so a change to the
 * real aggregation logic fails this test instead of a hand-copied stand-in.
 */

function loadHtml() {
  return readFileSync(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8');
}

function extractAggregation(html) {
  const m = html.match(
    /const zoneSpending = \{\};\nORG_SPENDING_ENTRIES\.forEach\(e => \{\n\s*zoneSpending\[e\.zone\] = \(zoneSpending\[e\.zone\] \|\| 0\) \+ \(e\.ask\.amountUsd \|\| 0\);\n\}\);\nconst maxZoneSpending = Math\.max\(0, \.\.\.Object\.values\(zoneSpending\)\);/,
  );
  if (!m) throw new Error('zoneSpending/maxZoneSpending aggregation moved or was renamed in web/index.html — update this test, do not skip it');
  return m[0];
}

function computeZoneSpending(orgSpendingEntries) {
  const fn = new Function('ORG_SPENDING_ENTRIES', `${extractAggregation(loadHtml())}\nreturn { zoneSpending, maxZoneSpending };`);
  return fn(orgSpendingEntries);
}

test('zoneSpending sums disclosed amountUsd per zone, across multiple orgs/periods in the same zone', () => {
  const entries = [
    { zone: 'La Mesa', ask: { amountUsd: 180000 } },
    { zone: 'La Mesa', ask: { amountUsd: 30000 } },
    { zone: 'Ocean Beach', ask: { amountUsd: 9500 } },
  ];
  const { zoneSpending, maxZoneSpending } = computeZoneSpending(entries);
  assert.equal(zoneSpending['La Mesa'], 210000);
  assert.equal(zoneSpending['Ocean Beach'], 9500);
  assert.equal(maxZoneSpending, 210000);
});

test('a zone with zero disclosures has no key in zoneSpending — zero is not a low value', () => {
  const entries = [{ zone: 'La Mesa', ask: { amountUsd: 1000 } }];
  const { zoneSpending } = computeZoneSpending(entries);
  assert.equal('Downtown' in zoneSpending, false, 'a zone with no org_spending_report entry must have no zoneSpending key at all');
});

test('no disclosures at all produces maxZoneSpending 0, not NaN or -Infinity', () => {
  const { zoneSpending, maxZoneSpending } = computeZoneSpending([]);
  assert.deepEqual(zoneSpending, {});
  assert.equal(maxZoneSpending, 0);
});

/**
 * Static checks on the render loop and legend, the same idiom
 * test/source-class.test.js uses for UI-only properties an eval'd function
 * snippet can't express on its own (DOM string-building, not pure computation).
 */

test("buildMap()'s funding layer skips a zone with NO org_spending_report entry entirely, rather than drawing a near-zero sliver", () => {
  const html = loadHtml();
  const m = html.match(/s \+= '<g class="funding" id="fundinglayer">';\n(?:.|\n)*?\n\s*s \+= '<\/g>';/);
  assert.ok(m, 'the funding layer render block moved or was renamed in web/index.html — update this test, do not skip it');
  assert.match(
    m[0],
    /if\(!\(k in zoneSpending\)\) continue;/,
    'the funding layer loop must key its skip on presence in zoneSpending, not on the amount being truthy — an org can validly disclose exactly $0, which must still render at floor opacity, distinct from no disclosure at all',
  );
});

test('a legitimate $0 disclosure gets a zoneSpending key (distinct from a zone with no disclosure)', () => {
  const entries = [{ zone: 'Chula Vista', ask: { amountUsd: 0 } }];
  const { zoneSpending } = computeZoneSpending(entries);
  assert.equal('Chula Vista' in zoneSpending, true, 'a $0 disclosure must still produce a zoneSpending key, not be treated as no disclosure');
  assert.equal(zoneSpending['Chula Vista'], 0);
});

/**
 * The funding choropleth (.fundfill) is pointer-events:none so it never steals the
 * existing zoom-in click target from .district — which means its own <title> is
 * unreachable by hover. The disclosure text has to live somewhere a user can
 * actually reach it: districtHoverStat(k)'s existing title on .shape.
 */
test('.funding/.fundfill stay pointer-events:none (never intercept the district zoom-in click)', () => {
  const html = loadHtml();
  assert.match(html, /\.funding\{pointer-events:none/, '.funding must stay pointer-events:none — this is what makes districtHoverStat() the required surface for the disclosure text, not a click-through regression');
});

test('districtHoverStat() appends the funding disclosure line to the reachable district hover title, not a second unreachable surface', () => {
  const html = loadHtml();
  const m = html.match(/function districtHoverStat\(k\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'districtHoverStat() moved or was renamed in web/index.html — update this test, do not skip it');
  const fn = new Function('TRENDS', 'monthLabel', 'money', 'zoneSpending', `${m[0]}\nreturn districtHoverStat;`)(
    { zones: {} },
    () => 'Jan',
    (n) => '$' + n,
    { downtown: 4200 },
  );
  assert.equal(fn('downtown'), ' · $4200 org spending disclosed (self-reported, not audited)');
  assert.equal(fn('la-mesa'), '', 'a zone with no TRENDS data and no disclosure must still return an empty string, not throw');
});

test("the funding layer's tooltip and legend carry the 'self-reported, not audited' framing (#58's explicit non-goal)", () => {
  const html = loadHtml();
  assert.match(html, /disclosed \(self-reported, not audited\)/, "the funding layer's per-zone tooltip must disclose it is self-reported and unaudited");
  assert.match(html, /self-reported, not audited or verified as\s*\n?\s*complete/, "the map legend's funding-layer entry must carry the same framing #18's Street Pulse disclaimer established");
});

test('the funding layer is a toggleable map layer, defaulting on, wired the same way as every other layer', () => {
  const html = loadHtml();
  assert.match(html, /layers:\{asks:true, spots:true, heat:true, svc:true, funding:true\}/, 'state.layers must default funding to true, alongside the existing layers');
  assert.match(html, /\["lay-funding","funding"\]/, 'lay-funding must be wired through the same layer-toggle forEach as every other layer button');
  assert.match(
    html,
    /document\.getElementById\("fundinglayer"\)\.classList\.toggle\("layer-off", !state\.layers\.funding\)/,
    'refreshMarkers() must toggle fundinglayer visibility off state.layers.funding',
  );
});
