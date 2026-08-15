/**
 * Non-pseudonymous org identity (#56, part of #54).
 *
 * Reuses loadOrCreateContributorKeyPair()'s actual key-generation and isolation
 * mechanism (../gateway/contributor-identity.ts) — the guarantee that a key never
 * overlaps another identity's key, or the org's own platform signing key
 * (keys/signing-key.json), is identical here. What this module deliberately does
 * NOT reuse is deriveContributorPseudonym(): that function exists specifically to
 * keep a handle (e.g. a phone number) off the public record via one-way hashing,
 * protection for a vulnerable individual. A spending-accountability disclosure
 * needs the opposite — the whole point of publishing it is public, named
 * accountability, so the org's real name is meant to appear in the published
 * data verbatim (consent.advocateId, domainPayload.data.orgName), never a
 * derived pseudonym.
 *
 * Do not "fix" this to match contributor-identity.ts's pseudonymizing pattern —
 * the asymmetry is deliberate, not an oversight. Only the on-disk key filename
 * is hashed (sha256(orgName)), and only because it's a filesystem path, not the
 * published identity; every published field carries the org's actual name.
 */

import { webcrypto, type JsonWebKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { KeyPairFiles } from '../sign.js';
import { toBase64, toHex } from '../encoding.js';

const subtle = webcrypto.subtle;

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export const ORG_KEYS_DIR = join('keys', 'orgs');

async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(digest);
}

/**
 * Loads an org's signing keypair from keys/orgs/, generating it on first use.
 * The on-disk filename is sha256(orgName), not the name itself — purely a
 * filesystem-path convenience, unlike contributor-identity.ts's hashed filename,
 * which also stands in for the pseudonym. The org's name itself is never derived
 * or hidden anywhere else; callers publish it verbatim.
 */
export async function loadOrCreateOrgKeyPair(orgName: string, baseDir = process.cwd()): Promise<KeyPairFiles> {
  if (!orgName || !orgName.trim()) throw new Error('orgName is required');

  const hash = await sha256Hex(orgName.trim());
  const keyPath = join(baseDir, ORG_KEYS_DIR, `${hash}.json`);

  if (existsSync(keyPath)) {
    const parsed = JSON.parse(await readFile(keyPath, 'utf8')) as KeyPairFiles;
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

  await mkdir(dirname(keyPath), { recursive: true });
  await writeFile(keyPath, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });

  return record;
}
