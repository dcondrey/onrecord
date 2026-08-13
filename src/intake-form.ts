/**
 * The local intake form served by `on-record serve` — a plain HTML <form>
 * (no JS, no fetch) so an advocate can add an entry from a phone or laptop
 * browser instead of the terminal. POSTs application/x-www-form-urlencoded
 * to /api/add; see cmdServe in cli.ts for the handler.
 */

import { ZONES, CATEGORIES, type Entry } from './schema.js';
import type { AddEntryOutput } from './add.js';

const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  id_documents: 'ID documents',
  shelter_bed: 'Shelter bed',
  medical: 'Medical',
  work_docs: 'Work documents',
  phone: 'Phone',
  transit: 'Transit',
  childcare: 'Childcare',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Parses an application/x-www-form-urlencoded body into a plain string map. */
export function parseIntakeFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) fields[key] = value;
  return fields;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — On Record</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 -apple-system, system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  label { display: block; font-weight: 600; margin: 1.25rem 0 0.25rem; }
  .hint { font-weight: 400; font-size: 0.875rem; opacity: 0.7; margin-top: 0.1rem; }
  input, select, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 0.5rem; border-radius: 6px; border: 1px solid #8888; }
  textarea { min-height: 6rem; resize: vertical; }
  button { margin-top: 1.5rem; font: inherit; font-weight: 600; padding: 0.6rem 1.2rem; border-radius: 6px; border: 0; background: #2563eb; color: #fff; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  .error { background: #fee; border: 1px solid #f99; color: #900; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
  .ok { background: #efe; border: 1px solid #9c9; color: #060; padding: 0.75rem 1rem; border-radius: 6px; }
  code { background: #8882; padding: 0.1rem 0.3rem; border-radius: 4px; }
  details { margin-top: 1.25rem; }
  summary { cursor: pointer; font-weight: 600; }
  .foot { margin-top: 2rem; font-size: 0.875rem; opacity: 0.7; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function renderIntakeForm(opts: { error?: string; values?: Record<string, string> } = {}): string {
  const v = opts.values ?? {};
  const zoneOptions = ZONES.map(
    (z) => `<option value="${escapeHtml(z)}"${v['zone'] === z ? ' selected' : ''}>${escapeHtml(z)}</option>`,
  ).join('');
  const categoryOptions = CATEGORIES.map(
    (cat) => `<option value="${escapeHtml(cat)}"${v['category'] === cat ? ' selected' : ''}>${escapeHtml(CATEGORY_LABELS[cat])}</option>`,
  ).join('');

  const body = `
<h1>On Record — add a request</h1>
${opts.error ? `<div class="error">${escapeHtml(opts.error)}</div>` : ''}
<form method="post" action="/api/add">
  <label for="zone">Zone</label>
  <select id="zone" name="zone" required>
    <option value="" disabled${v['zone'] ? '' : ' selected'}>Select a zone…</option>
    ${zoneOptions}
  </select>

  <label for="category">What they need</label>
  <select id="category" name="category" required>
    <option value="" disabled${v['category'] ? '' : ' selected'}>Select a category…</option>
    ${categoryOptions}
  </select>

  <label for="raw">Their account, in their own words</label>
  <div class="hint">Write it as told to you. A no-fabrication AI step will lightly clean it up for reading — nothing is added, and both versions are published together.</div>
  <textarea id="raw" name="raw" required>${escapeHtml(v['raw'] ?? '')}</textarea>

  <label for="summary">Short summary <span class="hint" style="display:inline">(optional — first few words of the account are used if left blank)</span></label>
  <input id="summary" name="summary" type="text" value="${escapeHtml(v['summary'] ?? '')}">

  <label for="amount">Dollar amount <span class="hint" style="display:inline">(optional)</span></label>
  <input id="amount" name="amount" type="number" min="0" step="0.01" value="${escapeHtml(v['amount'] ?? '')}">

  <label for="advocate">Your advocate ID</label>
  <div class="hint">Whatever identifies you as the person who recorded this — initials, org ID, etc.</div>
  <input id="advocate" name="advocate" type="text" required value="${escapeHtml(v['advocate'] ?? '')}">

  <label for="consent_method">How consent was given</label>
  <input id="consent_method" name="consent_method" type="text" required placeholder="verbal, in person, witnessed" value="${escapeHtml(v['consent_method'] ?? '')}">

  <details${v['org_claim'] ? ' open' : ''}>
    <summary>Organization claim (rare — only if you're citing what an org did)</summary>
    <label for="org_claim">Claim text</label>
    <input id="org_claim" name="org_claim" type="text" value="${escapeHtml(v['org_claim'] ?? '')}">
    <label for="org_source">Source</label>
    <div class="hint">Without a source, this is recorded but excluded from the signed record and marked alleged.</div>
    <input id="org_source" name="org_source" type="text" value="${escapeHtml(v['org_source'] ?? '')}">
  </details>

  <button type="submit">Sign and publish</button>
</form>
<p class="foot">This form does not issue recovery cards or set a status other than "requested" — use the <code>on-record add</code> CLI for those.</p>
`;
  return page('Add a request', body);
}

export function renderIntakeSuccess(output: AddEntryOutput): string {
  const entry: Entry = output.entry;
  const body = `
<h1>On Record — published</h1>
<div class="ok">
  <p><strong>${escapeHtml(entry.id)}</strong> — ${escapeHtml(entry.zone)} — ${escapeHtml(entry.ask.category)}</p>
  <p>${escapeHtml(entry.ask.summary)}</p>
  <p>contentHash <code>${escapeHtml(entry.provenance.contentHash)}</code></p>
</div>
<p><a href="/add">Add another request</a> &middot; <a href="/web/index.html">View the map</a></p>
`;
  return page('Published', body);
}
