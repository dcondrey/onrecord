import test from 'node:test';
import assert from 'node:assert/strict';

import { validateUnsigned, ValidationError } from '../dist/schema.js';
import { collectDomainPayload, DomainPayloadInputError, DOMAIN_PAYLOAD_SCHEMAS } from '../dist/domain-payloads.js';
import { promptInteractiveAdd, promptRawStory } from '../dist/interactive-add.js';

/**
 * The interactive `on-record add` prompt engine (#21) branches by category:
 * when a domainPayload schema is registered for the selected category, it
 * collects and validates that shape; otherwise it doesn't. These tests drive
 * the underlying prompt functions directly with a scripted `ask()` instead
 * of a real TTY (promptInteractiveAdd/collectDomainPayload take an injected
 * AskFn for exactly this reason — see interactive-add.ts's header comment).
 */

function scripted(answers) {
  const queue = [...answers];
  return async () => {
    if (queue.length === 0) throw new Error('scripted ask() ran out of answers');
    return queue.shift();
  };
}

function baseUnsigned(overrides = {}) {
  return {
    id: 'or_test_interactive',
    zone: 'Downtown',
    ask: { category: 'work_docs', summary: 'test entry' },
    story: { raw: 'raw text', shaped: 'shaped text' },
    consent: { advocateId: 'adv_1', method: 'verbal, in person', timestampISO: new Date().toISOString() },
    status: 'requested',
    ...overrides,
  };
}

test('collectDomainPayload: string/number/boolean fields are coerced and typed', async () => {
  const schema = {
    kind: 'org.onrecord.example/v1',
    fields: [
      { name: 'note', label: 'Note', type: 'string', required: true },
      { name: 'count', label: 'Count', type: 'number', required: true },
      { name: 'urgent', label: 'Urgent', type: 'boolean', required: false },
    ],
  };
  const ask = scripted(['hello', '3', 'y']);
  const payload = await collectDomainPayload(schema, ask);
  assert.deepEqual(payload, { kind: 'org.onrecord.example/v1', data: { note: 'hello', count: 3, urgent: true } });
});

test('collectDomainPayload: re-prompts on invalid input, gives up after too many bad answers', async () => {
  const schema = { kind: 'k/v1', fields: [{ name: 'n', label: 'N', type: 'number', required: true }] };
  const badForever = () => Promise.resolve('not-a-number');
  await assert.rejects(() => collectDomainPayload(schema, badForever), DomainPayloadInputError);
});

test('collectDomainPayload: blank optional field is omitted, never written as null', async () => {
  const schema = {
    kind: 'k/v1',
    fields: [
      { name: 'required_field', label: 'Required', type: 'string', required: true },
      { name: 'optional_field', label: 'Optional', type: 'string', required: false },
    ],
  };
  const ask = scripted(['value', '']);
  const payload = await collectDomainPayload(schema, ask);
  assert.equal('optional_field' in payload.data, false);
  assert.equal(payload.data.required_field, 'value');
});

test('collectDomainPayload: blank required field re-prompts until answered', async () => {
  const schema = { kind: 'k/v1', fields: [{ name: 'n', label: 'N', type: 'string', required: true }] };
  const ask = scripted(['', '', 'finally']);
  const payload = await collectDomainPayload(schema, ask);
  assert.equal(payload.data.n, 'finally');
});

test('promptInteractiveAdd: category with no registered schema produces no domainPayload', async () => {
  const ask = scripted([
    'Downtown', // zone
    'medical', // category (no schema registered for this in the test's registry)
    '', // summary (blank -> undefined)
    '', // amount (blank -> undefined)
    'adv_1', // advocate id
    'verbal, in person', // consent method
  ]);
  const result = await promptInteractiveAdd(ask, { schemas: { work_docs: exampleSchema() } });
  assert.equal(result.domainPayload, undefined);
  assert.equal(result.advocateId, 'adv_1');
  assert.equal(result.consentMethod, 'verbal, in person');

  const unsigned = baseUnsigned({ ask: { category: result.category, summary: 'x' } });
  assert.doesNotThrow(() => validateUnsigned(unsigned));
});

test('promptInteractiveAdd: category with a registered schema collects and validates that shape', async () => {
  const ask = scripted([
    'Downtown', // zone
    'work_docs', // category (schema registered below)
    '', // summary
    '', // amount
    'hello', // domainPayload field: note
    '3', // domainPayload field: count
    'adv_1', // advocate id
    'verbal, in person', // consent method
  ]);
  const result = await promptInteractiveAdd(ask, { schemas: { work_docs: exampleSchema() } });
  assert.deepEqual(result.domainPayload, { kind: 'org.onrecord.example/v1', data: { note: 'hello', count: 3 } });

  const unsigned = baseUnsigned({
    ask: { category: result.category, summary: 'x' },
    domainPayload: result.domainPayload,
  });
  assert.doesNotThrow(() => validateUnsigned(unsigned));
});

test('promptInteractiveAdd: with and without a registered schema reject a blank advocate identically', async () => {
  // Both branches share the same consent prompts after the (optional) domainPayload
  // collection, so a blank advocate answer loops the same way regardless of which
  // branch ran. We can't script an infinite blank loop, so this exercises the
  // shared downstream gate directly: validateUnsigned() must reject both the same way.
  const withSchema = baseUnsigned({
    ask: { category: 'work_docs', summary: 'x' },
    domainPayload: { kind: 'org.onrecord.example/v1', data: { note: 'hello', count: 3 } },
    consent: { advocateId: '', method: 'verbal', timestampISO: new Date().toISOString() },
  });
  const withoutSchema = baseUnsigned({
    ask: { category: 'medical', summary: 'x' },
    consent: { advocateId: '', method: 'verbal', timestampISO: new Date().toISOString() },
  });

  const messageOf = (fn) => {
    try {
      fn();
      throw new Error('expected validateUnsigned to throw');
    } catch (err) {
      assert.ok(err instanceof ValidationError);
      return err.message;
    }
  };
  const msg1 = messageOf(() => validateUnsigned(withSchema));
  const msg2 = messageOf(() => validateUnsigned(withoutSchema));
  assert.equal(msg1, msg2);
  assert.match(msg1, /CONSENT REQUIRED/);
});

test('a domainPayload field named "address" is still refused by assertNoPreciseLocation', async () => {
  const schema = { kind: 'k/v1', fields: [{ name: 'address', label: 'Address', type: 'string', required: true }] };
  const ask = scripted(['123 Main St']);
  const payload = await collectDomainPayload(schema, ask);
  const unsigned = baseUnsigned({ domainPayload: payload });
  assert.throws(() => validateUnsigned(unsigned), /precise-location field/);
});

test('#29: rental_listing is registered against work_docs and transit in the real DOMAIN_PAYLOAD_SCHEMAS registry', async () => {
  for (const category of ['work_docs', 'transit']) {
    const schema = DOMAIN_PAYLOAD_SCHEMAS[category];
    assert.equal(schema?.kind, 'rental_listing', `expected rental_listing registered for ${category}`);
    const fieldNames = schema.fields.map((f) => f.name).sort();
    assert.deepEqual(fieldNames, ['rentAmountUsd', 'reportedAtISO', 'unitType', 'zone'].sort());
  }

  const ask = scripted([
    'Downtown', // zone
    'transit', // category
    '', // summary
    '', // amount
    '1850', // rentAmountUsd
    'studio', // unitType
    'Downtown', // zone (domainPayload field)
    '2026-08-01T00:00:00Z', // reportedAtISO
    'adv_1', // advocate id
    'verbal, in person', // consent method
  ]);
  const result = await promptInteractiveAdd(ask); // real registry, no override
  assert.deepEqual(result.domainPayload, {
    kind: 'rental_listing',
    data: { rentAmountUsd: 1850, unitType: 'studio', zone: 'Downtown', reportedAtISO: '2026-08-01T00:00:00Z' },
  });

  const unsigned = baseUnsigned({
    ask: { category: result.category, summary: 'x' },
    domainPayload: result.domainPayload,
  });
  assert.doesNotThrow(() => validateUnsigned(unsigned));
});

test('#29: leaving every rental_listing field blank produces no domainPayload, and consent is still enforced', async () => {
  const ask = scripted([
    'Downtown', // zone
    'work_docs', // category
    '', // summary
    '', // amount
    '', // rentAmountUsd (blank, optional)
    '', // unitType (blank, optional)
    '', // zone field (blank, optional)
    '', // reportedAtISO (blank, optional)
    'adv_1', // advocate id
    'verbal, in person', // consent method
  ]);
  const result = await promptInteractiveAdd(ask); // real registry, no override
  assert.equal(result.domainPayload, undefined, 'an all-blank rental_listing answer should not sign an empty domainPayload');
  assert.equal(result.advocateId, 'adv_1');
  assert.equal(result.consentMethod, 'verbal, in person');

  const unsigned = baseUnsigned({ ask: { category: result.category, summary: 'x' } });
  assert.doesNotThrow(() => validateUnsigned(unsigned));
});

test('promptRawStory: collects lines until a blank line', async () => {
  const ask = scripted(['first line', 'second line', '']);
  const raw = await promptRawStory(ask);
  assert.equal(raw, 'first line\nsecond line');
});

function exampleSchema() {
  return {
    kind: 'org.onrecord.example/v1',
    fields: [
      { name: 'note', label: 'Note', type: 'string', required: true },
      { name: 'count', label: 'Count', type: 'number', required: true },
    ],
  };
}
