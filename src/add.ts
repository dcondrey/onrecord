/**
 * The `add` pipeline as a throwing function: raw story -> Claude transform ->
 * sign -> append. Shared by the CLI (`on-record add`) and the local intake
 * form served by `on-record serve`.
 *
 * Unlike the CLI's cmdAdd, this never calls process.exit — every failure is an
 * AddEntryError (or whatever the transform/signing layers throw), so a caller
 * embedding this in an HTTP handler can catch it and respond instead of taking
 * the whole server down.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  isCategory,
  isSourceClass,
  isStatus,
  isZone,
  validateUnsigned,
  ValidationError,
  ZONES,
  CATEGORIES,
  SOURCE_CLASSES,
  STATUSES,
  type Entry,
  type UnsignedEntry,
} from './schema.js';
import {
  buildManifest,
  loadOrCreateKeyPair,
  sha256Hex,
  signEntryCose,
  type KeyPairFiles,
  type Manifest,
} from './sign.js';
import { SYSTEM_PROMPT, transform, TransformRefusalError, type TransformResult } from './transform.js';
import { ENTRIES_PATH, MANIFESTS_DIR, DATA_DIR } from './seed.js';
import { buildDidDocument, didKeyFromPublicJwk } from './did.js';
import { dobCandidates, dobIsAmbiguous, normalizeDob, recoveryIdentityTag, recoveryTag } from './recovery.js';

export class AddEntryError extends Error {
  override readonly name = 'AddEntryError';
}

function fail(msg: string): never {
  throw new AddEntryError(msg);
}

export interface AddEntryInput {
  raw: string;
  zone: string;
  category: string;
  status?: string;
  summary?: string;
  /** Raw string, same as the CLI's --amount: parsed and range-checked here. */
  amount?: string;
  advocateId: string;
  consentMethod: string;
  consentAt?: string;
  orgClaimText?: string;
  orgClaimSource?: string;
  recoveryPhrase?: string;
  recoveryPin?: string;
  confirmedDob?: string;
  first3?: string;
  last3?: string;
  dob?: string;
  zip?: string;
  id?: string;
  /** Who is asserting this entry — see schema.ts's SourceClass. Absent means the
   *  default advocate_attested tier; only the SMS gateway (src/gateway/sms.ts) sets
   *  this today, always to 'self_attested_witness'. */
  sourceClass?: string;
}

export interface AddEntryOutput {
  entry: Entry;
  manifest: Manifest;
  manifestPath: string;
  transformResult: TransformResult;
  recoveryPhrase?: string;
  recoveryPin?: string;
  identity?: { first3: string; last3: string; dateOfBirth: string; postalCode: string };
}

export async function addEntry(
  input: AddEntryInput,
  opts: {
    onStatus?: (msg: string) => void;
    transform?: typeof transform;
    /** Overrides the org signing key (keys/signing-key.json). Pass a contributor's
     *  own isolated key (src/gateway/contributor-identity.ts) to sign under their
     *  tier instead — existing call sites omit this and get the org key, unchanged. */
    keys?: KeyPairFiles;
    /** Required, and checked, only when input.sourceClass is 'self_attested_witness'
     *  — see validateUnsigned()'s self_attested_witness gate in schema.ts. */
    contributorPseudonym?: string;
    /** Skips the data/entries.json + manifest-file write, returning the signed
     *  entry/manifest for the caller to hold elsewhere (e.g. the SMS gateway's
     *  data/pending-review.json sidecar) instead of publishing it immediately.
     *  AddEntryOutput.manifestPath is still computed and returned in this case,
     *  naming where the manifest would land if published — nothing is written
     *  there yet. */
    holdForReview?: boolean;
  } = {},
): Promise<AddEntryOutput> {
  const doTransform = opts.transform ?? transform;
  const raw = input.raw.trim();
  if (!raw) fail('no raw story provided.');

  const zone = input.zone;
  if (!isZone(zone)) fail(`unknown zone "${zone}". One of: ${ZONES.join(', ')}`);

  const category = input.category;
  if (!isCategory(category)) fail(`unknown category "${category}". One of: ${CATEGORIES.join(', ')}`);

  const status = input.status ?? 'requested';
  if (!isStatus(status)) fail(`unknown status "${status}". One of: ${STATUSES.join(', ')}`);

  const sourceClass = input.sourceClass;
  if (sourceClass !== undefined && !isSourceClass(sourceClass)) {
    fail(`unknown sourceClass "${sourceClass}". One of: ${SOURCE_CLASSES.join(', ')}`);
  }

  const summary = input.summary?.trim() || raw.split(/\s+/).slice(0, 10).join(' ');

  let amountUsd: number | undefined;
  if (input.amount !== undefined && input.amount !== '') {
    amountUsd = Number(input.amount);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) fail('amount must be a non-negative number');
  }

  const advocateId = input.advocateId.trim();
  if (!advocateId) fail('an advocate is required. Entries without a named advocate are refused — consent is not optional.');

  const consentMethod = input.consentMethod.trim();
  if (!consentMethod) fail('consent method is required, e.g. "verbal, in person, witnessed".');

  const consentAt = input.consentAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(consentAt))) fail('consent timestamp must be an ISO 8601 timestamp');

  const orgClaimText = input.orgClaimText?.trim() || undefined;
  const orgClaimSource = input.orgClaimSource?.trim() || undefined;
  const recoveryPhrase = input.recoveryPhrase;
  const recoveryPin = input.recoveryPin;
  const confirmedDob = input.confirmedDob;
  const identity = { first3: input.first3, last3: input.last3, dateOfBirth: input.dob, postalCode: input.zip };
  const hasIdentity = Object.values(identity).some(Boolean);
  if (hasIdentity && Object.values(identity).some((v) => !v)) fail('first3, last3, dob, and zip must be supplied together');
  if (hasIdentity && recoveryPhrase) fail('choose either identity recovery or a recovery phrase, not both');
  if ((recoveryPhrase && !recoveryPin) || (!recoveryPhrase && !hasIdentity && recoveryPin)) {
    fail('a recovery phrase or the four identity fields must be supplied with a recovery PIN');
  }
  if (hasIdentity && !recoveryPin) fail('identity recovery also requires a recovery PIN');
  if (hasIdentity && identity.dateOfBirth && dobIsAmbiguous(identity.dateOfBirth)) {
    if (!confirmedDob || !/^\d{4}-\d{2}-\d{2}$/.test(confirmedDob) || !dobCandidates(identity.dateOfBirth).includes(normalizeDob(confirmedDob))) {
      fail(`date of birth "${identity.dateOfBirth}" is ambiguous. Confirm one intended ISO date. Options: ${dobCandidates(identity.dateOfBirth).join(', ')}`);
    }
  }

  const ask: UnsignedEntry['ask'] = { category, summary };
  if (amountUsd !== undefined) ask.amountUsd = amountUsd;

  const id = input.id ?? `or_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  // Early pre-flight check only — cheap UX, catches an obvious collision before
  // paying for the Claude call below. The write path re-reads and re-checks this
  // file immediately before appending (see readEntries() near the bottom), since
  // a multi-second gap sits between this read and that write and a second writer
  // (another CLI invocation, or a concurrent /api/add request outside this
  // process's intakeQueue) could commit in between.
  const readEntries = async (): Promise<Entry[]> =>
    existsSync(ENTRIES_PATH) ? (JSON.parse(await readFile(ENTRIES_PATH, 'utf8')) as Entry[]) : [];
  if ((await readEntries()).some((e) => e.id === id)) {
    fail(`id "${id}" already exists in ${ENTRIES_PATH}. Pass a different id or omit it to generate one.`);
  }

  // Shape the story before validating: an entry is not writable until it has
  // both halves, and we want the AI failure to surface before we touch disk.
  //
  // A refusal is handled, not propagated: the accounts most likely to trigger
  // a safety refusal (assault, withdrawal, being turned away) are exactly the
  // ones SYSTEM_PROMPT says must never be softened, so treating a refusal as a
  // hard failure would make the most urgent requests the least publishable.
  // The system prompt already treats shaped ≈ raw as a correct outcome ("An
  // under-shaped entry is a correct outcome"); this is that same fallback,
  // just triggered by a refusal instead of a sparse raw note. Every other
  // transform() failure (missing key, empty input, network error) still
  // propagates — those mean nothing was written, not that shaping was skipped.
  opts.onStatus?.('calling Claude to shape the story...');
  let result: TransformResult;
  let aiTransformApplied = true;
  try {
    result = await doTransform({ raw, ask, zone });
  } catch (err) {
    if (!(err instanceof TransformRefusalError)) throw err;
    opts.onStatus?.('Claude declined to shape this story; publishing the raw text unchanged.');
    aiTransformApplied = false;
    result = { shaped: raw, model: 'none (Claude declined to shape this story)', inputTokens: 0, outputTokens: 0 };
  }

  const unsigned: UnsignedEntry = {
    id,
    zone,
    ask,
    story: { raw, shaped: result.shaped },
    consent: { advocateId, method: consentMethod, timestampISO: consentAt },
    ...(sourceClass ? { sourceClass } : {}),
    ...(recoveryPhrase && recoveryPin
      ? { recovery: { scheme: 'claim-card/v1' as const, verifierTag: await recoveryTag(recoveryPhrase, recoveryPin, id) } }
      : {}),
    ...(hasIdentity && recoveryPin
      ? {
          recovery: {
            scheme: 'claim-card/identity-v1' as const,
            verifierTag: await recoveryIdentityTag(identity as { first3: string; last3: string; dateOfBirth: string; postalCode: string }, recoveryPin, id),
          },
        }
      : {}),
    status,
  };

  try {
    validateUnsigned(unsigned, { contributorPseudonym: opts.contributorPseudonym });
  } catch (err) {
    if (err instanceof ValidationError) fail(err.message);
    throw err;
  }

  const keys = opts.keys ?? (await loadOrCreateKeyPair());
  // did.json publishes the org's own issuer DID — never touched for a contributor
  // key, so a contributor submission can't overwrite it with unrelated key material.
  if (!opts.keys) {
    const issuer = process.env['ONRECORD_ISSUER_DID']?.trim() || didKeyFromPublicJwk(keys.publicJwk);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(join(DATA_DIR, 'did.json'), JSON.stringify(buildDidDocument(issuer, keys.publicJwk), null, 2) + '\n');
  }
  const entry = await signEntryCose(unsigned, keys);
  entry.provenance.signerTier = opts.keys ? 'contributor' : 'org';

  const manifest = await buildManifest({
    entry,
    aiTransform: {
      applied: aiTransformApplied,
      model: result.model,
      promptSha256: await sha256Hex(SYSTEM_PROMPT),
      method: aiTransformApplied
        ? 'Raw advocate text re-rendered by Claude under a no-fabrication system prompt.'
        : 'Claude declined to shape this story under the no-fabrication system prompt; the raw text was published unchanged rather than the entry going unwritten.',
      // Omitted (not zeroed) on a declined transform: a refusal still costs tokens on
      // Claude's side, and we have no way to report that count without a deeper change
      // to transform()'s throw-based contract, so "no usage reported" beats implying 0.
      ...(aiTransformApplied ? { inputTokens: result.inputTokens, outputTokens: result.outputTokens } : {}),
    },
    ...(orgClaimText
      ? {
          orgClaim: {
            text: orgClaimText,
            ...(orgClaimSource ? { source: orgClaimSource } : {}),
            alleged: !orgClaimSource,
          },
        }
      : {}),
  });

  const manifestPath = join(MANIFESTS_DIR, `${entry.id}.json`);
  if (!opts.holdForReview) {
    await mkdir(MANIFESTS_DIR, { recursive: true });
    // Re-read immediately before the write, not the stale array from the pre-flight
    // check above — the Claude call and signing in between can take several seconds,
    // long enough for another writer to have appended in the meantime.
    const entries = await readEntries();
    if (entries.some((e) => e.id === entry.id)) {
      fail(`id "${entry.id}" was written by another process while this entry was being shaped. Retry with a different id.`);
    }
    entries.push(entry);
    await writeFile(ENTRIES_PATH, JSON.stringify(entries, null, 2) + '\n');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  return {
    entry,
    manifest,
    manifestPath,
    transformResult: result,
    ...(recoveryPhrase && recoveryPin ? { recoveryPhrase, recoveryPin } : {}),
    ...(hasIdentity && recoveryPin ? { recoveryPin, identity: identity as { first3: string; last3: string; dateOfBirth: string; postalCode: string } } : {}),
  };
}
