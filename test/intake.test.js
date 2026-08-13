import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntakeFields, renderIntakeForm } from '../dist/intake-form.js';

test('parseIntakeFields decodes form-urlencoded bodies, including quotes and reserved chars', () => {
  const fields = parseIntakeFields('raw=she%20said%20%22help%22&zone=Downtown&amount=');
  assert.equal(fields.raw, 'she said "help"');
  assert.equal(fields.zone, 'Downtown');
  assert.equal(fields.amount, '');
});

test('renderIntakeForm escapes a submitted value containing HTML/quote characters', () => {
  const html = renderIntakeForm({ values: { raw: '<script>alert("x")</script>' } });
  assert.ok(!html.includes('<script>alert("x")</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderIntakeForm surfaces an error banner when given one', () => {
  const html = renderIntakeForm({ error: 'no raw story provided.' });
  assert.ok(html.includes('no raw story provided.'));
  assert.ok(html.includes('class="error"'));
});
