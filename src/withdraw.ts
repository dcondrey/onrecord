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
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, ENTRIES_PATH, MANIFESTS_DIR } from './seed.js';
import type { Entry } from './schema.js';

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

export async function withdrawEntry(id: string, reason?: string): Promise<WithdrawResult> {
  if (!id.trim()) throw new WithdrawError('an entry id is required');
  if (!existsSync(ENTRIES_PATH)) throw new WithdrawError(`${ENTRIES_PATH} does not exist — nothing to withdraw`);

  const entries = JSON.parse(await readFile(ENTRIES_PATH, 'utf8')) as Entry[];
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) throw new WithdrawError(`no entry with id "${id}" found in ${ENTRIES_PATH}`);
  const [entry] = entries.splice(index, 1) as [Entry];

  await writeFile(ENTRIES_PATH, JSON.stringify(entries, null, 2) + '\n');

  const manifestPath = join(MANIFESTS_DIR, `${id}.json`);
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
