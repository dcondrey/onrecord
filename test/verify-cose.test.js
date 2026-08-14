import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { signEntryCose } from '../dist/sign.js';
import { validateUnsigned } from '../dist/schema.js';
import { toBase64 } from '../dist/encoding.js';
import { verifyFile } from '../dist/verify.js';

/**
 * The browser's protocol-v2 (COSE_Sign1) verifier is a hand-ported reimplementation
 * of src/sign.ts's verifyCoseEntry, exactly the kind of drift CLAUDE.md warns about
 * ("nothing in CI catches a divergence between them"). Two real bugs shipped to the
 * live demo before this test existed: cborRead() called ENC.decode() on a
 * TextEncoder (no such method — needed a TextDecoder), and seal() double-base64-
 * decoded an already-raw signature. Both silently broke verification for every
 * real committed entry (boot's try/catch swallowed the exception and showed a
 * misleading "WebCrypto unavailable" message instead). This test runs the actual
 * shipped verifier — extracted from web/index.html, not hand-copied — against the
 * real committed entries so that class of bug fails CI instead of shipping quietly.
 */
function loadBrowserVerifier() {
  const htmlPath = fileURLToPath(new URL('../web/index.html', import.meta.url));
  const html = readFileSync(htmlPath, 'utf8');

  function extract(name, re) {
    const m = html.match(re);
    if (!m) throw new Error(`Could not find ${name} in web/index.html. It moved or was renamed — update the regex above, do not skip this test.`);
    return m[0];
  }

  const src = [
    'const ENC = new TextEncoder();',
    'const DEC = new TextDecoder();',
    extract('ZONE_ALIASES', /const ZONE_ALIASES = \{[^}]*\};/),
    // projectV2, cbor, and verifyV2 are genuinely multi-line, so a non-greedy
    // \n} correctly bounds them at their own closing brace.
    extract('projectV2', /function projectV2\(e\)\{[\s\S]*?\n\}/),
    // Every function below this line is written as a single editor line (the
    // file's terse style for small helpers). A \n}-terminated regex has no
    // newline to match before that line's own closing brace, so it silently
    // overreaches forward to the next \n} anywhere later in the file — in the
    // worst case swallowing everything up to the end of verifyV2, duplicating
    // whatever the neighboring explicit extracts already grabbed. That stayed
    // invisible while duplicated content was only `function` declarations
    // (harmless to redeclare via `new Function`); it turned into a hard
    // SyntaxError the moment a duplicated `const` (B58_ALPHABET) landed in
    // the mix. [^\n]* cannot cross a line boundary, so this bounds each
    // single-line function to its own line regardless of what follows it.
    extract('cborHead', /function cborHead\(m,n\)\{[^\n]*\n/),
    extract('cborJoin', /function cborJoin\(a\)\{[^\n]*\n/),
    extract('cbor', /function cbor\(v\)\{[\s\S]*?\n\}/),
    extract('cborRead', /function cborRead\(b,s=\{i:0\}\)\{[^\n]*\n/),
    extract('b64bytes', /function b64bytes\(v\)\{[^\n]*\n/),
    extract('hexBytes', /function hexBytes\(v\)\{[^\n]*\n/),
    extract('v2Unsigned', /function v2Unsigned\(e\)\{[^\n]*\n/),
    extract('B58_ALPHABET', /const B58_ALPHABET="[^"]*";/),
    extract('base58', /function base58\(bytes\)\{[^\n]*\n/),
    extract('b64urlBytes', /function b64urlBytes\(value\)\{[^\n]*\n/),
    extract('didKeyFromPublicJwk', /function didKeyFromPublicJwk\(jwk\)\{[^\n]*\n/),
    extract('verificationMethodForDid', /function verificationMethodForDid\(did\)\{[^\n]*\n/),
    extract('verifyV2', /async function verifyV2\(e\)\{[\s\S]*?\n\}/),
  ].join('\n\n');

  const factory = new Function('crypto', `${src}\nreturn {verifyV2, projectV2};`);
  return factory(webcrypto);
}

function loadRealEntries() {
  const entriesPath = fileURLToPath(new URL('../data/entries.json', import.meta.url));
  return JSON.parse(readFileSync(entriesPath, 'utf8'));
}

test('browser COSE verifier accepts every real committed entry', async () => {
  const { verifyV2, projectV2 } = loadBrowserVerifier();
  const entries = loadRealEntries();
  assert.ok(entries.length > 0, 'data/entries.json has no entries to check');
  for (const raw of entries) {
    assert.equal(raw.provenance.protocolVersion, '2.0', `${raw.id} is not protocol v2 — this test only covers the COSE path`);
    const projected = projectV2(raw);
    const r = await verifyV2(projected);
    assert.equal(r.ok, true, `${raw.id} failed browser verification: ${JSON.stringify(r)}`);
  }
});

test('browser COSE verifier rejects a tampered shaped story', async () => {
  const { verifyV2, projectV2 } = loadBrowserVerifier();
  const [raw] = loadRealEntries();
  const tampered = projectV2(raw);
  tampered.story = { ...tampered.story, shaped: tampered.story.shaped + ' (edited after signing)' };
  const r = await verifyV2(tampered);
  assert.equal(r.ok, false, 'tampering the shaped story should break verification');
});

test('browser COSE verifier rejects a stripped issuer', async () => {
  // Found by /suggest audit: verifyV2() never checked issuer/verificationMethod
  // at all, so this passed as ok:true prior to the fix, while the Node verifier
  // (verifyCoseEntry, src/sign.ts) correctly rejected the identical tamper.
  const { verifyV2, projectV2 } = loadBrowserVerifier();
  const [raw] = loadRealEntries();
  const tampered = projectV2(raw);
  tampered.provenance = { ...tampered.provenance, issuer: undefined };
  const r = await verifyV2(tampered);
  assert.equal(r.ok, false, 'a missing issuer should break verification');
});

test('browser COSE verifier rejects a verificationMethod that does not match the issuer', async () => {
  const { verifyV2, projectV2 } = loadBrowserVerifier();
  const [raw] = loadRealEntries();
  const tampered = projectV2(raw);
  tampered.provenance = { ...tampered.provenance, verificationMethod: tampered.provenance.verificationMethod + 'x' };
  const r = await verifyV2(tampered);
  assert.equal(r.ok, false, 'a verificationMethod not matching #key-1 of the stated issuer should break verification');
});

test('browser COSE verifier rejects an issuer that does not match the embedded pubKey', async () => {
  const { verifyV2, projectV2 } = loadBrowserVerifier();
  const [raw] = loadRealEntries();
  const tampered = projectV2(raw);
  const fakeIssuer = 'did:key:z4oJ8cTXLb1Cp5bQK5KNL1ryUaqTUptQHquTMuyG397AKPeYqitssiu6tSitCMHofn2sRVAgWTcgc8YSg8wibW3CUBeUZ';
  tampered.provenance = { ...tampered.provenance, issuer: fakeIssuer, verificationMethod: fakeIssuer + '#key-1' };
  const r = await verifyV2(tampered);
  assert.equal(r.ok, false, 'an issuer that does not derive from the embedded pubKey should break verification');
});

/**
 * domainPayload (#20) is the escape hatch for future domain-specific data that
 * doesn't warrant its own typed field the way shelterStatus does. A fresh
 * keypair (never keys/signing-key.json) signs a fixture carrying one, and both
 * independent verifiers — src/verify.ts (via a real on-disk entries.json, the
 * same path `on-record verify` takes) and the browser's hand-ported verifyV2()
 * — must agree it's valid, and must agree a tamper to domainPayload.data breaks it.
 */
async function signedDomainPayloadFixture(dataOverride) {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const pubKey = toBase64(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  const keys = { privateJwk, publicJwk, pubKey, createdISO: new Date().toISOString() };

  const unsigned = {
    id: 'or_test_domain_payload',
    zone: 'Downtown',
    ask: { category: 'work_docs', summary: 'test ask carrying a domainPayload fixture' },
    story: { raw: 'raw test story', shaped: 'shaped test story' },
    consent: { advocateId: 'adv_test_01', method: 'verbal, in person, witnessed', timestampISO: '2026-08-01T00:00:00Z' },
    domainPayload: { kind: 'org.onrecord.example/v1', data: dataOverride ?? { foo: 'bar', count: 3 } },
    status: 'requested',
  };
  assert.doesNotThrow(() => validateUnsigned(unsigned), 'a well-formed domainPayload should pass validateUnsigned');

  return signEntryCose(unsigned, keys);
}

test('an entry with domainPayload verifies through src/verify.ts and the browser verifyV2()', async () => {
  const entry = await signedDomainPayloadFixture();

  const dir = await mkdtemp(join(tmpdir(), 'onrecord-domain-payload-'));
  try {
    const path = join(dir, 'entries.json');
    await writeFile(path, JSON.stringify([entry]));
    const report = await verifyFile(path);
    assert.equal(report.total, 1);
    assert.equal(report.verified, 1);
    assert.equal(report.failed, 0);
    assert.equal(report.entries[0].ok, true, `CLI verifier rejected a clean domainPayload entry: ${JSON.stringify(report.entries[0])}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const { verifyV2, projectV2 } = loadBrowserVerifier();
  const projected = projectV2(entry);
  assert.deepEqual(projected.domainPayload, entry.domainPayload, 'projectV2 must carry domainPayload through unchanged');
  const r = await verifyV2(projected);
  assert.equal(r.ok, true, `browser verifier rejected a clean domainPayload entry: ${JSON.stringify(r)}`);
});

test('tampering domainPayload.data breaks both verifiers', async () => {
  const entry = await signedDomainPayloadFixture();
  const tampered = structuredClone(entry);
  tampered.domainPayload.data.foo = 'tampered';

  const dir = await mkdtemp(join(tmpdir(), 'onrecord-domain-payload-tamper-'));
  try {
    const path = join(dir, 'entries.json');
    await writeFile(path, JSON.stringify([tampered]));
    const report = await verifyFile(path);
    assert.equal(report.entries[0].ok, false, 'CLI verifier should reject a tampered domainPayload');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const { verifyV2, projectV2 } = loadBrowserVerifier();
  const r = await verifyV2(projectV2(tampered));
  assert.equal(r.ok, false, 'browser verifier should reject a tampered domainPayload');
});
