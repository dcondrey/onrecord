/**
 * Pseudonymous contributor identity.
 *
 * Mirrors loadOrCreateKeyPair() in ../sign.ts, but keyed by sha256(handle) rather
 * than a single fixed path, and written under keys/contributors/ — a directory
 * that never overlaps keys/signing-key.json (the org key). This is deliberate:
 * a contributor-tier signature must never be reachable from, or mistakable for,
 * the org's own key material. See Provenance.signerTier in ../schema.ts, which
 * records which tier signed an entry independently of what the entry says.
 */

import { webcrypto, type JsonWebKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { KeyPairFiles } from '../sign.js';
import { toBase64, toHex } from '../encoding.js';

const subtle = webcrypto.subtle;

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export const CONTRIBUTOR_KEYS_DIR = join('keys', 'contributors');

// Domain-separated from the bare sha256(handle) used for the key filename above,
// so the pseudonym a contributor's entries are published under can't be used to
// derive keys/contributors/<hash>.json, or vice versa.
const PSEUDONYM_DOMAIN = 'onrecord-contributor-pseudonym-v1:';

async function sha256Hex(input: string): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(digest);
}

/**
 * Loads a contributor's signing keypair from keys/contributors/, generating it
 * on first use. The on-disk filename is sha256(handle), not the handle itself,
 * so the pseudonym is never readable straight off the filesystem. Each handle
 * gets its own file at mode 0o600, isolated from every other contributor's key
 * and from the org key in keys/signing-key.json.
 */
export async function loadOrCreateContributorKeyPair(
  handle: string,
  baseDir = process.cwd(),
): Promise<KeyPairFiles> {
  if (!handle || !handle.trim()) throw new Error('handle is required');

  const hash = await sha256Hex(handle.trim());
  const keyPath = join(baseDir, CONTRIBUTOR_KEYS_DIR, `${hash}.json`);

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

/**
 * Deterministic, one-way public pseudonym for a contributor handle — what
 * self_attested_witness and self_attested_personal entries publish as
 * consent.advocateId (see validateUnsigned() in ../schema.ts). Same handle always yields the same
 * pseudonym, without the handle itself (e.g. a phone number) ever being
 * written to disk.
 */
export async function deriveContributorPseudonym(handle: string): Promise<string> {
  if (!handle || !handle.trim()) throw new Error('handle is required');
  const hash = await sha256Hex(PSEUDONYM_DOMAIN + handle.trim());
  return `contrib_${hash.slice(0, 16)}`;
}
