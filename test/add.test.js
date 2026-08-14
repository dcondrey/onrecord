import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry, AddEntryError } from '../dist/add.js';
import { TransformRefusalError } from '../dist/transform.js';

/**
 * addEntry() is the shared pipeline behind both `on-record add` and the
 * /api/add HTTP form — untested until now, despite being the one place the
 * consent gate, id-collision check, recovery-scheme rules, and DOB-ambiguity
 * confirmation all actually run. Runs against a temp cwd (its own data/,
 * manifests/, keys/) via the injectable `transform` option added for exactly
 * this, so no real ANTHROPIC_API_KEY, network call, or repo file is touched.
 */

const BASE_INPUT = {
  raw: 'needs help finding a shelter bed for tonight',
  zone: 'Downtown',
  category: 'shelter_bed',
  advocateId: 'adv_test_01',
  consentMethod: 'verbal, in person, witnessed',
};

const stubTransform = async ({ raw }) => ({ shaped: `shaped: ${raw}`, model: 'stub-model', inputTokens: 1, outputTokens: 1 });

async function withTempCwd(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'onrecord-add-test-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    await fn(dir);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

test('consent gate rejects a missing advocate', async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      addEntry({ ...BASE_INPUT, advocateId: '' }, { transform: stubTransform }),
      AddEntryError,
    );
  });
});

test('consent gate rejects a missing consent method', async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      addEntry({ ...BASE_INPUT, consentMethod: '' }, { transform: stubTransform }),
      AddEntryError,
    );
  });
});

test('duplicate id is rejected', async () => {
  await withTempCwd(async () => {
    const first = await addEntry({ ...BASE_INPUT, id: 'or_dupe_test' }, { transform: stubTransform });
    assert.equal(first.entry.id, 'or_dupe_test');
    await assert.rejects(
      addEntry({ ...BASE_INPUT, id: 'or_dupe_test' }, { transform: stubTransform }),
      AddEntryError,
    );
  });
});

test('recovery phrase and identity fields are mutually exclusive', async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      addEntry(
        {
          ...BASE_INPUT,
          recoveryPhrase: 'river copper lantern echo',
          recoveryPin: '4417',
          first3: 'mar',
          last3: 'del',
          dob: '1984-02-03',
          zip: '92101',
        },
        { transform: stubTransform },
      ),
      AddEntryError,
    );
  });
});

test('an ambiguous DOB requires explicit confirmation', async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      addEntry(
        { ...BASE_INPUT, first3: 'mar', last3: 'del', dob: '01/02/1980', zip: '92101', recoveryPin: '4417' },
        { transform: stubTransform },
      ),
      AddEntryError,
    );
    // Same DOB, now confirmed, succeeds.
    const output = await addEntry(
      {
        ...BASE_INPUT,
        first3: 'mar',
        last3: 'del',
        dob: '01/02/1980',
        confirmedDob: '1980-01-02',
        zip: '92101',
        recoveryPin: '4417',
      },
      { transform: stubTransform },
    );
    assert.ok(output.entry.recovery);
  });
});

test('a Claude refusal falls back to unshaped raw text, honestly disclosed in the manifest', async () => {
  await withTempCwd(async () => {
    const refusalTransform = async () => {
      throw new TransformRefusalError('declined');
    };
    const output = await addEntry({ ...BASE_INPUT }, { transform: refusalTransform });
    assert.equal(output.entry.story.shaped, output.entry.story.raw);
    const aiAssertion = output.manifest.assertions.find((a) => a.label === 'org.onrecord.ai-transform');
    assert.equal(aiAssertion.data.applied, false);
    assert.match(aiAssertion.data.method, /declined/i);
  });
});

test('a non-refusal transform error still propagates (nothing published)', async () => {
  await withTempCwd(async () => {
    const networkErrorTransform = async () => {
      throw new Error('network error, not a refusal');
    };
    await assert.rejects(
      addEntry({ ...BASE_INPUT }, { transform: networkErrorTransform }),
      /network error/,
    );
  });
});

test('self_attested_witness skips the Claude transform entirely (#49) — no call made, no cost incurred', async () => {
  await withTempCwd(async () => {
    const unreachableTransform = async () => {
      throw new Error('transform must not be called for self_attested_witness');
    };
    const output = await addEntry(
      {
        ...BASE_INPUT,
        sourceClass: 'self_attested_witness',
        advocateId: 'contrib_0123456789abcdef',
      },
      { transform: unreachableTransform, contributorPseudonym: 'contrib_0123456789abcdef' },
    );
    assert.equal(output.entry.story.shaped, output.entry.story.raw);
    const aiAssertion = output.manifest.assertions.find((a) => a.label === 'org.onrecord.ai-transform');
    assert.equal(aiAssertion.data.applied, false);
    assert.doesNotMatch(aiAssertion.data.method, /declined/i);
    assert.match(aiAssertion.data.method, /self_attested_witness/);
  });
});

test('self_attested_personal still gets the Claude transform (shaping is the point there)', async () => {
  await withTempCwd(async () => {
    const output = await addEntry(
      {
        ...BASE_INPUT,
        sourceClass: 'self_attested_personal',
        advocateId: 'contrib_fedcba9876543210',
      },
      { transform: stubTransform, contributorPseudonym: 'contrib_fedcba9876543210' },
    );
    assert.equal(output.entry.story.shaped, `shaped: ${BASE_INPUT.raw}`);
    const aiAssertion = output.manifest.assertions.find((a) => a.label === 'org.onrecord.ai-transform');
    assert.equal(aiAssertion.data.applied, true);
  });
});
