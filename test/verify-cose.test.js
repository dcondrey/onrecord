import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

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
