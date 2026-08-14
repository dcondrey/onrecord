/**
 * Signing + C2PA-style provenance manifests.
 *
 * Scheme (kept deliberately simple so a browser can re-verify with crypto.subtle):
 *   canonical = canonicalize(entry-without-provenance)   // schema.ts, fixed key order
 *   digest    = SHA-256(utf8(canonical))                 // 32 bytes
 *   signature = ECDSA-P256-SHA256(digest)                // signed over the DIGEST BYTES
 *
 * contentHash is the lowercase hex of `digest`; signature is base64 of the raw
 * 64-byte IEEE-P1363 r||s pair (what WebCrypto emits — not DER); pubKey is base64
 * of the SPKI DER. A verifier can therefore check two things independently:
 * did the content change (hash), and was this key the signer (signature).
 */

import { webcrypto, type JsonWebKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalize, type Entry, type Provenance, type UnsignedEntry } from './schema.js';
import { fromBase64, toBase64, toHex } from './encoding.js';
import { encodeCanonical } from './cbor.js';
import { signCoseSign1, verifyCoseSign1 } from './cose.js';
import { didKeyFromPublicJwk, resolvePinnedVerificationMethod, samePublicJwk, type DidTrustDocument, verificationMethodForDid } from './did.js';

const subtle = webcrypto.subtle;

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

export const CLAIM_GENERATOR = 'on-record/1.0 (ECDSA-P256; hackathon build)';
export const MANIFEST_VERSION = '1.2';

// --- encoding helpers -------------------------------------------------------

export { fromBase64, toBase64, toHex } from './encoding.js';

export async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(digest);
}

/** SHA-256 of the canonical form, as raw bytes — this is what actually gets signed. */
async function digestOf(entry: UnsignedEntry): Promise<ArrayBuffer> {
  return subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(entry)));
}

// --- keypair ----------------------------------------------------------------

export interface KeyPairFiles {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  /** base64 SPKI DER — this is what ships in every entry's provenance block. */
  pubKey: string;
  createdISO: string;
}

export const KEYS_DIR = 'keys';
const PRIVATE_PATH = join(KEYS_DIR, 'signing-key.json');
const PUBLIC_PATH = join(KEYS_DIR, 'public-key.json');

/**
 * Loads the signing keypair from keys/, generating it on first use.
 *
 * These are local development keys held as plaintext JWK on disk. That is a
 * deliberate hackathon tradeoff, not a recommendation — see README.
 */
export async function loadOrCreateKeyPair(baseDir = process.cwd()): Promise<KeyPairFiles> {
  const privatePath = join(baseDir, PRIVATE_PATH);

  if (existsSync(privatePath)) {
    const parsed = JSON.parse(await readFile(privatePath, 'utf8')) as KeyPairFiles;
    return parsed;
  }

  const pair = await subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const privateJwk = (await subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const publicJwk = (await subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const spki = await subtle.exportKey('spki', pair.publicKey);

  const record: KeyPairFiles = {
    privateJwk,
    publicJwk,
    pubKey: toBase64(spki),
    createdISO: new Date().toISOString(),
  };

  await mkdir(dirname(privatePath), { recursive: true });
  await writeFile(privatePath, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  await writeFile(
    join(baseDir, PUBLIC_PATH),
    JSON.stringify(
      { publicJwk: record.publicJwk, pubKey: record.pubKey, createdISO: record.createdISO },
      null,
      2,
    ) + '\n',
  );

  return record;
}

/** Short human-comparable fingerprint of a public key. */
export async function keyFingerprint(pubKeyB64: string): Promise<string> {
  const digest = await subtle.digest('SHA-256', fromBase64(pubKeyB64));
  return toHex(digest).slice(0, 16);
}

// --- sign / verify ----------------------------------------------------------

export async function signEntry(unsigned: UnsignedEntry, keys: KeyPairFiles): Promise<Entry> {
  const privateKey = await subtle.importKey('jwk', keys.privateJwk, ALGORITHM, false, ['sign']);
  const digest = await digestOf(unsigned);
  const signature = await subtle.sign(SIGN_PARAMS, privateKey, digest);

  const provenance: Provenance = {
    alg: 'ECDSA-P256',
    contentHash: toHex(digest),
    signature: toBase64(signature),
    pubKey: keys.pubKey,
    manifestVersion: MANIFEST_VERSION,
    signedAtISO: new Date().toISOString(),
  };

  return { ...unsigned, provenance };
}

/**
 * Protocol v2: deterministic CBOR payload + detached COSE_Sign1 ES256.
 * The legacy provenance shape remains present for readers that only display
 * entries; v2 verifiers select the COSE envelope explicitly.
 */
export async function signEntryCose(unsigned: UnsignedEntry, keys: KeyPairFiles): Promise<Entry> {
  const payload = encodeCanonical(JSON.parse(canonicalize(unsigned)) as Record<string, unknown>);
  const cose = await signCoseSign1(payload, keys.privateJwk, 'key-1');
  const digest = await subtle.digest('SHA-256', payload);
  const issuer = process.env['ONRECORD_ISSUER_DID']?.trim() || didKeyFromPublicJwk(keys.publicJwk);
  const provenance: Provenance = {
    alg: 'COSE-ES256', contentHash: toHex(digest), pubKey: keys.pubKey,
    manifestVersion: MANIFEST_VERSION, signedAtISO: new Date().toISOString(), protocolVersion: '2.0',
    issuer, verificationMethod: verificationMethodForDid(issuer), cborPayload: toBase64(payload), coseSign1: cose.sign1,
  };
  return { ...unsigned, provenance };
}

export async function verifyCoseEntry(entry: Entry, trustDocument?: DidTrustDocument): Promise<boolean> {
  const p = entry.provenance;
  if (p.protocolVersion !== '2.0' || !p.cborPayload || !p.coseSign1) return false;
  if (!p.issuer || p.verificationMethod !== verificationMethodForDid(p.issuer)) return false;
  const payload = fromBase64(p.cborPayload);
  const { provenance: _provenance, ...rest } = entry;
  const expectedPayload = encodeCanonical(JSON.parse(canonicalize(rest)) as Record<string, unknown>);
  if (payload.length !== expectedPayload.length || payload.some((byte, i) => byte !== expectedPayload[i])) return false;
  if (p.issuer?.startsWith('did:key:')) {
    const publicJwkForDid = await subtle.exportKey('jwk', await subtle.importKey('spki', fromBase64(p.pubKey), ALGORITHM, true, ['verify'])) as JsonWebKey;
    if (didKeyFromPublicJwk(publicJwkForDid) !== p.issuer) return false;
  }
  const digest = await subtle.digest('SHA-256', payload);
  if (toHex(digest) !== p.contentHash) return false;
  const publicJwk = await subtle.exportKey('jwk', await subtle.importKey('spki', fromBase64(p.pubKey), ALGORITHM, true, ['verify'])) as JsonWebKey;
  if (trustDocument) {
    const trusted = resolvePinnedVerificationMethod(trustDocument, p.verificationMethod);
    if (!trusted || !samePublicJwk(trusted, publicJwk)) return false;
  }
  return verifyCoseSign1({ sign1: p.coseSign1, payload: p.cborPayload, algorithm: 'ES256' }, payload, publicJwk);
}

export interface VerifyResult {
  hashMatches: boolean;
  signatureValid: boolean;
  /** Hash recomputed from the file's own content, not read from the provenance block. */
  recomputedHash: string;
  claimedHash: string;
  error?: string;
}

/**
 * Checks an entry's seal. Recomputes the hash from the entry's actual content —
 * it never trusts provenance.contentHash — so an edit to the story and a matching
 * edit to the hash still fail, because the signature covers the digest.
 */
export async function verifyEntry(entry: Entry): Promise<VerifyResult> {
  const { provenance, ...rest } = entry;
  const unsigned = rest as UnsignedEntry;

  let recomputedHash = '';
  try {
    if (!provenance.signature) throw new Error('legacy provenance has no signature');
    const digest = await digestOf(unsigned);
    recomputedHash = toHex(digest);
    const claimedHash = provenance?.contentHash ?? '';
    const hashMatches = recomputedHash === claimedHash;

    const publicKey = await subtle.importKey('spki', fromBase64(provenance.pubKey), ALGORITHM, true, [
      'verify',
    ]);
    const signatureValid = await subtle.verify(
      SIGN_PARAMS,
      publicKey,
      fromBase64(provenance.signature),
      digest,
    );

    return { hashMatches, signatureValid, recomputedHash, claimedHash };
  } catch (err) {
    return {
      hashMatches: false,
      signatureValid: false,
      recomputedHash,
      claimedHash: provenance?.contentHash ?? '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- C2PA-style manifest ----------------------------------------------------

export interface Assertion {
  label: string;
  data: Record<string, unknown>;
}

export interface AiTransformDisclosure {
  applied: boolean;
  model: string;
  promptSha256: string;
  method: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface OrgClaim {
  text: string;
  source?: string;
  alleged: boolean;
}

export interface Manifest {
  /** Explicit bridge format; this is not a claim of C2PA conformance. */
  format: 'org.onrecord.c2pa-bridge/1';
  manifestVersion: string;
  claimGenerator: string;
  instanceId: string;
  createdISO: string;
  assertions: Assertion[];
  /**
   * Claims that did NOT make it into the signed assertions, and why. Present in
   * the manifest for transparency; deliberately outside the signature's scope so
   * an unsourced allegation is never cryptographically vouched for.
   */
  unsignedNotes?: Record<string, unknown>[];
  signature: {
    alg: 'ECDSA-P256' | 'COSE-ES256';
    contentHash: string;
    signature: string;
    pubKey: string;
    keyFingerprint: string;
    signedAtISO: string;
    /** What the signature actually covers. */
    scope: string;
    protocolVersion?: string;
    issuer?: string;
    verificationMethod?: string;
    coseSign1?: string;
  };
  claim: {
    instanceId: string;
    asset: { mediaType: 'application/json'; cborSha256: string };
    assertions: string[];
  };
}

export interface BuildManifestInput {
  entry: Entry;
  aiTransform: AiTransformDisclosure;
  orgClaim?: OrgClaim;
  composite?: boolean;
}

export async function buildManifest(input: BuildManifestInput): Promise<Manifest> {
  const { entry, aiTransform, orgClaim, composite = false } = input;
  const rawHash = await sha256Hex(entry.story.raw);
  const shapedHash = await sha256Hex(entry.story.shaped);

  const assertions: Assertion[] = [
    {
      label: 'org.onrecord.consent',
      data: {
        advocateId: entry.consent.advocateId,
        method: entry.consent.method,
        timestampISO: entry.consent.timestampISO,
        recordedBeforePublication: true,
      },
    },
    {
      label: 'org.onrecord.story.hash',
      data: {
        rawSha256: rawHash,
        shapedSha256: shapedHash,
        bothPublished: true,
      },
    },
    {
      // C2PA's own label for generative/AI-assisted edits.
      label: 'c2pa.actions',
      data: {
        actions: [
          {
            action: aiTransform.applied ? 'c2pa.edited' : 'c2pa.created',
            softwareAgent: aiTransform.applied ? aiTransform.model : CLAIM_GENERATOR,
            digitalSourceType: aiTransform.applied
              ? 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced'
              : 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
            description: aiTransform.method,
          },
        ],
      },
    },
    {
      label: 'org.onrecord.ai-transform',
      data: {
        applied: aiTransform.applied,
        model: aiTransform.model,
        systemPromptSha256: aiTransform.promptSha256,
        method: aiTransform.method,
        constraint:
          'Prompt forbids introducing any fact absent from the raw text, softening the account, or adding claims about any organization.',
        rawTextRetained: true,
        ...(aiTransform.inputTokens !== undefined
          ? { usage: { inputTokens: aiTransform.inputTokens, outputTokens: aiTransform.outputTokens } }
          : {}),
      },
    },
    {
      label: 'org.onrecord.location-precision',
      data: {
        granularity: 'zone',
        zone: entry.zone,
        note: 'Zone only. No coordinates, addresses, or shelter names are collected or stored.',
      },
    },
  ];

  if (composite) {
    assertions.push({
      label: 'org.onrecord.composite',
      data: {
        composite: true,
        note: 'Illustrative composite. Not a real individual. Seed data only.',
      },
    });
  }

  // Guardrail: a dollar claim directed at an organization is only ever a signed
  // assertion when it carries a source. Otherwise it stays in the manifest as an
  // unsigned, explicitly-alleged note.
  const unsignedNotes: Record<string, unknown>[] = [];
  if (orgClaim) {
    if (orgClaim.source) {
      assertions.push({
        label: 'org.onrecord.org-claim',
        data: { text: orgClaim.text, source: orgClaim.source, alleged: false },
      });
    } else {
      unsignedNotes.push({
        label: 'org.onrecord.org-claim',
        text: orgClaim.text,
        alleged: true,
        excludedFromSignedAssertions: true,
        reason: 'No source provided. Unsourced organization-directed claims are not signed.',
      });
    }
  }

  return {
    format: 'org.onrecord.c2pa-bridge/1',
    manifestVersion: MANIFEST_VERSION,
    claimGenerator: CLAIM_GENERATOR,
    instanceId: `urn:onrecord:entry:${entry.id}`,
    createdISO: new Date().toISOString(),
    assertions,
    ...(unsignedNotes.length ? { unsignedNotes } : {}),
    signature: {
      alg: entry.provenance.alg,
      contentHash: entry.provenance.contentHash,
      signature: entry.provenance.coseSign1 ?? entry.provenance.signature ?? '',
      pubKey: entry.provenance.pubKey,
      keyFingerprint: await keyFingerprint(entry.provenance.pubKey),
      signedAtISO: entry.provenance.signedAtISO,
      scope:
        entry.provenance.protocolVersion === '2.0'
          ? 'Detached COSE_Sign1 ES256 over the deterministic-CBOR encoding of all entry fields except `provenance`; contentHash is SHA-256 of those CBOR bytes.'
          : 'SHA-256 over the canonical serialization of all entry fields except `provenance`; legacy signature retained for v1 compatibility.',
      ...(entry.provenance.protocolVersion === '2.0'
        ? {
            protocolVersion: entry.provenance.protocolVersion,
            issuer: entry.provenance.issuer,
            verificationMethod: entry.provenance.verificationMethod,
            coseSign1: entry.provenance.coseSign1,
          }
        : {}),
    },
    claim: {
      instanceId: `urn:onrecord:entry:${entry.id}`,
      asset: { mediaType: 'application/json', cborSha256: entry.provenance.contentHash },
      assertions: assertions.map((assertion) => assertion.label),
    },
  };
}
