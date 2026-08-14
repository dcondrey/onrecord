/**
 * Withdrawal: removing an entry from the public record for good, at the
 * requester's word alone — the same "ongoing, not a one-time signature"
 * consent model the browser demo narrates. This deliberately does NOT
 * re-sign or tombstone the entry in data/entries.json; it deletes it.
 *
 * A withdrawal still leaves a trace, but only an internal one: id, zone,
 * category, and when — never the raw or shaped story text — written to
 * data/withdrawn.json. That file is gitignored, never served by
 * `on-record serve`, and never embedded into web/index.html by
 * scripts/sync-web-data.mjs (which only ever reads data/entries.json).
 *
 * withdrawEntry() below is "at the requester's word alone" because the CLI
 * operator IS the trust boundary for advocate-attested entries. That does not
 * hold for self-attested entries (#14/#28): there is no advocate mediating,
 * only the contributor's own pseudonymous key, so anyone who merely knew an
 * entry id could otherwise withdraw someone else's account.
 * withdrawSelfAttestedEntry() requires a signature over the entry id that
 * verifies against the same public key embedded in the entry's own
 * provenance — i.e. produced by the same key that signed the entry.
 */

import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, ENTRIES_PATH, MANIFESTS_DIR } from './seed.js';
import type { Entry } from './schema.js';
import { fromBase64, toBase64 } from './encoding.js';
import type { KeyPairFiles } from './sign.js';

const subtle = webcrypto.subtle;
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

// Domain-separated from every other signature this codebase produces (entry
// signing in sign.ts, pseudonym derivation in gateway/contributor-identity.ts)
// so a withdrawal signature can never be replayed as, or mistaken for, an
// entry-signing signature over the same bytes.
const WITHDRAW_DOMAIN = 'onrecord-withdraw-v1:';

export class WithdrawError extends Error {
  override readonly name = 'WithdrawError';
}

export const WITHDRAWN_LOG_PATH = join(DATA_DIR, 'withdrawn.json');

export interface WithdrawnRecord {
  id: string;
  zone: string;
  category: string;
  withdrawnAtISO: string;
  reason?: string;
}

export interface WithdrawResult {
  entry: Entry;
  manifestPath: string;
  manifestDeleted: boolean;
  logPath: string;
}

async function removeEntry(entries: Entry[], index: number, reason?: string): Promise<WithdrawResult> {
  const [entry] = entries.splice(index, 1) as [Entry];

  await writeFile(ENTRIES_PATH, JSON.stringify(entries, null, 2) + '\n');

  const manifestPath = join(MANIFESTS_DIR, `${entry.id}.json`);
  const manifestDeleted = existsSync(manifestPath);
  if (manifestDeleted) await rm(manifestPath);

  const log: WithdrawnRecord[] = existsSync(WITHDRAWN_LOG_PATH)
    ? (JSON.parse(await readFile(WITHDRAWN_LOG_PATH, 'utf8')) as WithdrawnRecord[])
    : [];
  log.push({
    id: entry.id,
    zone: entry.zone,
    category: entry.ask.category,
    withdrawnAtISO: new Date().toISOString(),
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
  });
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(WITHDRAWN_LOG_PATH, JSON.stringify(log, null, 2) + '\n');

  return { entry, manifestPath, manifestDeleted, logPath: WITHDRAWN_LOG_PATH };
}

export async function withdrawEntry(id: string, reason?: string): Promise<WithdrawResult> {
  if (!id.trim()) throw new WithdrawError('an entry id is required');
  if (!existsSync(ENTRIES_PATH)) throw new WithdrawError(`${ENTRIES_PATH} does not exist — nothing to withdraw`);

  const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf8')) as Entry[];
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) throw new WithdrawError(`no entry with id "${id}" found in ${ENTRIES_PATH}`);
  return removeEntry(entries, index, reason);
}

/** Signs a withdrawal request for `id` with a contributor's own key (loaded
 *  by handle via gateway/contributor-identity.ts, same as at add time). */
export async function signWithdrawRequest(id: string, keys: Pick<KeyPairFiles, 'privateJwk'>): Promise<string> {
  const privateKey = await subtle.importKey('jwk', keys.privateJwk, ALGORITHM, false, ['sign']);
  const signature = await subtle.sign(SIGN_PARAMS, privateKey, new TextEncoder().encode(WITHDRAW_DOMAIN + id));
  return toBase64(signature);
}

/** True only if `signatureB64` was produced by the private key matching
 *  `entry.provenance.pubKey` — the key that signed the entry itself. */
export async function verifyWithdrawRequest(entry: Entry, signatureB64: string): Promise<boolean> {
  try {
    const publicKey = await subtle.importKey('spki', fromBase64(entry.provenance.pubKey), ALGORITHM, true, ['verify']);
    const payload = new TextEncoder().encode(WITHDRAW_DOMAIN + entry.id);
    return await subtle.verify(SIGN_PARAMS, publicKey, fromBase64(signatureB64), payload);
  } catch {
    return false;
  }
}

/**
 * Contributor-scoped withdrawal for self-attested entries (sourceClass
 * 'self_attested_witness' / 'self_attested_personal'). Requires a signature
 * that verifies against the entry's own embedded pubKey, so only whoever
 * holds the private key that originally signed the entry can retract it —
 * not anyone who merely knows the entry id.
 */
export async function withdrawSelfAttestedEntry(id: string, signatureB64: string, reason?: string): Promise<WithdrawResult> {
  if (!id.trim()) throw new WithdrawError('an entry id is required');
  if (!signatureB64?.trim()) throw new WithdrawError('a withdrawal signature is required');
  if (!existsSync(ENTRIES_PATH)) throw new WithdrawError(`${ENTRIES_PATH} does not exist — nothing to withdraw`);

  const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf8')) as Entry[];
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) throw new WithdrawError(`no entry with id "${id}" found in ${ENTRIES_PATH}`);
  const entry = entries[index] as Entry;

  if (entry.sourceClass !== 'self_attested_witness' && entry.sourceClass !== 'self_attested_personal') {
    throw new WithdrawError(
      `entry "${id}" is not self-attested (sourceClass "${entry.sourceClass ?? 'advocate_attested'}"); use withdrawEntry() instead`,
    );
  }
  if (!(await verifyWithdrawRequest(entry, signatureB64))) {
    throw new WithdrawError(
      'withdrawal signature does not verify against the key that signed this entry — only the original contributor can withdraw it',
    );
  }

  return removeEntry(entries, index, reason);
}
