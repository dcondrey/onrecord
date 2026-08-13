/**
 * Independent verifier — the accountability guarantee.
 *
 * This module deliberately shares nothing with the write path except the schema
 * and the crypto primitives. It re-reads the JSON file from disk, re-derives the
 * canonical form from the entry's *actual* content, recomputes the hash, and
 * checks the signature against the public key embedded in the entry itself.
 *
 * It never trusts `provenance.contentHash`. Editing a story and editing the hash
 * to match still fails, because the signature is over the digest bytes.
 *
 * Anyone can run this against a published entries.json without holding a key,
 * without contacting this server, and without trusting whoever published it.
 */

import { readFile } from 'node:fs/promises';
import { assertNoPreciseLocation, canonicalize, parseEntry, type Entry } from './schema.js';
import { keyFingerprint, verifyCoseEntry, verifyEntry, type VerifyResult } from './sign.js';
import type { DidTrustDocument } from './did.js';

export interface EntryReport {
  index: number;
  id: string;
  zone: string;
  status: string;
  ok: boolean;
  result: VerifyResult;
  keyFingerprint: string;
  /** Populated only on failure, to make the tamper obvious in output. */
  diagnosis?: string;
}

export interface VerifyReport {
  file: string;
  total: number;
  verified: number;
  failed: number;
  entries: EntryReport[];
  /** Distinct signing keys seen across the file. More than one is worth noticing. */
  keys: string[];
  statusCounts: Record<string, number>;
  parseError?: string;
}

function diagnose(result: VerifyResult): string {
  if (result.error) return `verification error: ${result.error}`;
  if (!result.hashMatches && !result.signatureValid) {
    return 'CONTENT MODIFIED — the entry no longer hashes to its recorded contentHash, and the signature does not cover the current content.';
  }
  if (!result.hashMatches) {
    return 'CONTENT MODIFIED — recomputed hash does not match the recorded contentHash.';
  }
  return 'SIGNATURE INVALID — content hashes correctly but the signature does not verify under the embedded public key (key swapped, or signature forged/corrupted).';
}

export async function verifyFile(path: string, options: { trustDocument?: DidTrustDocument } = {}): Promise<VerifyReport> {
  const report: VerifyReport = {
    file: path,
    total: 0,
    verified: 0,
    failed: 0,
    entries: [],
    keys: [],
    statusCounts: {},
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    report.parseError = err instanceof Error ? err.message : String(err);
    return report;
  }

  // A single exported record (see export.ts's entry.json — the whole point of
  // an export bundle is one standalone entry, not an array-of-one) is just as
  // valid an input here as the full entries.json array. `on-record export`'s
  // own VERIFY.txt tells a reader to run `on-record verify entry.json`, so
  // this had to accept exactly that shape.
  let entriesRaw: unknown[];
  if (Array.isArray(parsed)) {
    entriesRaw = parsed;
  } else if (parsed !== null && typeof parsed === 'object') {
    entriesRaw = [parsed];
  } else {
    report.parseError = `expected a JSON array of entries (or a single entry object) in ${path}`;
    return report;
  }

  const keys = new Set<string>();

  for (let i = 0; i < entriesRaw.length; i++) {
    report.total++;
    let entry: Entry;
    try {
      entry = parseEntry(entriesRaw[i], i);
    } catch (err) {
      report.failed++;
      report.entries.push({
        index: i,
        id: '(unparseable)',
        zone: '-',
        status: '-',
        ok: false,
        keyFingerprint: '-',
        result: {
          hashMatches: false,
          signatureValid: false,
          recomputedHash: '',
          claimedHash: '',
          error: err instanceof Error ? err.message : String(err),
        },
        diagnosis: `MALFORMED ENTRY — ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const result = entry.provenance.protocolVersion === '2.0'
      ? await verifyCose(entry, options.trustDocument)
      : await verifyEntry(entry);
    const fp = entry.provenance?.pubKey ? await keyFingerprint(entry.provenance.pubKey) : '-';
    keys.add(fp);

    report.statusCounts[entry.status] = (report.statusCounts[entry.status] ?? 0) + 1;

    // canonicalize() only reads whitelisted fields, so a smuggled key (e.g. a
    // hand-added `location` block) is invisible to signature verification above.
    let locationLeak: string | undefined;
    try {
      assertNoPreciseLocation(entry);
    } catch (err) {
      locationLeak = err instanceof Error ? err.message : String(err);
    }

    const ok = result.hashMatches && result.signatureValid && !locationLeak;

    if (ok) report.verified++;
    else report.failed++;

    report.entries.push({
      index: i,
      id: entry.id,
      zone: entry.zone,
      status: entry.status,
      ok,
      result,
      keyFingerprint: fp,
      ...(ok ? {} : { diagnosis: locationLeak ? `PRECISE LOCATION FOUND — ${locationLeak}` : diagnose(result) }),
    });
  }

  report.keys = [...keys];
  return report;
}

/**
 * verifyCoseEntry() can throw (e.g. malformed base64 in pubKey/coseSign1, a
 * corrupted CBOR payload) rather than returning false — the same class of
 * malformed input verifyEntry()'s v1 path already survives via its own
 * try/catch. Without this wrapper, one corrupted v2 entry would abort
 * verifyFile()'s whole loop instead of reporting that entry as a clean FAIL.
 */
async function verifyCose(entry: Entry, trustDocument?: DidTrustDocument): Promise<VerifyResult> {
  try {
    const valid = await verifyCoseEntry(entry, trustDocument);
    return {
      hashMatches: valid,
      signatureValid: valid,
      recomputedHash: entry.provenance.contentHash,
      claimedHash: entry.provenance.contentHash,
      ...(valid ? {} : { error: 'COSE_Sign1 or detached CBOR payload failed verification' }),
    };
  } catch (err) {
    return {
      hashMatches: false,
      signatureValid: false,
      recomputedHash: '',
      claimedHash: entry.provenance?.contentHash ?? '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Exposed for debugging: show exactly what bytes were hashed for a given entry. */
export function canonicalFormOf(entry: Entry): string {
  const { provenance: _provenance, ...rest } = entry;
  return canonicalize(rest);
}
