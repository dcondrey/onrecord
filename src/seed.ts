/**
 * Seed data runner.
 *
 * Reads the composite sample records from seeds.data.ts, signs each one, and
 * writes data/entries.json plus per-entry manifests. Offline and deterministic by
 * default — a demo must not depend on a network call to have something to render.
 *
 * By default the shaped text is pre-composed rather than produced by Claude, and
 * the manifest says so (`ai-transform.applied: false`). Pass --ai to actually run
 * each raw story through the live transform; the manifest then records the model.
 * Claiming AI involvement that did not happen would break the same transparency
 * guarantee this project exists to demonstrate.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SEEDS, ORG_SPENDING_SEEDS, type SeedRecord } from './seeds.data.js';
import {
  isBedStatus,
  isCategory,
  isSafetyLevel,
  isSourceClass,
  isStatus,
  isStoragePolicy,
  isZone,
  validateUnsigned,
  ValidationError,
  type Entry,
  type SourceClass,
  type UnsignedEntry,
} from './schema.js';
import { buildManifest, loadOrCreateKeyPair, sha256Hex, signEntryCose } from './sign.js';
import { SYSTEM_PROMPT, modelId, transform } from './transform.js';
import { buildDidDocument, didKeyFromPublicJwk } from './did.js';
import { loadOrCreateOrgKeyPair } from './gateway/org-identity.js';

export const DATA_DIR = 'data';
export const ENTRIES_PATH = join(DATA_DIR, 'entries.json');
export const MANIFESTS_DIR = join(DATA_DIR, 'manifests');

const COMPOSITE_PREFIX = '[COMPOSITE — not a real individual] ';

function toUnsigned(seed: SeedRecord): UnsignedEntry {
  if (!isZone(seed.zone)) throw new ValidationError(`seed ${seed.id}: bad zone "${seed.zone}"`);
  if (!isCategory(seed.ask.category)) {
    throw new ValidationError(`seed ${seed.id}: bad category "${seed.ask.category}"`);
  }
  if (!isStatus(seed.status)) throw new ValidationError(`seed ${seed.id}: bad status "${seed.status}"`);

  const ask: UnsignedEntry['ask'] = { category: seed.ask.category, summary: seed.ask.summary };
  if (seed.ask.amountUsd !== undefined) ask.amountUsd = seed.ask.amountUsd;

  let shelterStatus: UnsignedEntry['shelterStatus'];
  if (seed.shelterStatus) {
    const s = seed.shelterStatus;
    if (!isBedStatus(s.bedStatus)) throw new ValidationError(`seed ${seed.id}: bad shelterStatus.bedStatus "${s.bedStatus}"`);
    if (!isStoragePolicy(s.storagePolicy)) {
      throw new ValidationError(`seed ${seed.id}: bad shelterStatus.storagePolicy "${s.storagePolicy}"`);
    }
    if (!isSafetyLevel(s.safetyVolatility)) {
      throw new ValidationError(`seed ${seed.id}: bad shelterStatus.safetyVolatility "${s.safetyVolatility}"`);
    }
    shelterStatus = {
      bedStatus: s.bedStatus,
      ...(s.estimatedOpenings !== undefined ? { estimatedOpenings: s.estimatedOpenings } : {}),
      restrictions: { ...s.restrictions },
      storagePolicy: s.storagePolicy,
      safetyVolatility: s.safetyVolatility,
    };
  }

  if (seed.sourceClass !== undefined && !isSourceClass(seed.sourceClass)) {
    throw new ValidationError(`seed ${seed.id}: bad sourceClass "${seed.sourceClass}"`);
  }

  return {
    id: seed.id,
    zone: seed.zone,
    ask,
    story: { raw: seed.story.raw, shaped: seed.story.shaped },
    consent: {
      advocateId: seed.consent.advocateId,
      method: seed.consent.method,
      timestampISO: seed.consent.timestampISO,
    },
    ...(seed.sourceClass ? { sourceClass: seed.sourceClass as SourceClass } : {}),
    ...(shelterStatus ? { shelterStatus } : {}),
    ...(seed.domainPayload ? { domainPayload: seed.domainPayload } : {}),
    status: seed.status,
  };
}

export interface SeedOptions {
  useAi: boolean;
  baseDir?: string;
}

export interface SeedOutcome {
  entries: Entry[];
  entriesPath: string;
  manifestsDir: string;
  aiApplied: boolean;
}

export async function runSeed(options: SeedOptions): Promise<SeedOutcome> {
  const baseDir = options.baseDir ?? process.cwd();
  const keys = await loadOrCreateKeyPair(baseDir);
  const issuer = process.env['ONRECORD_ISSUER_DID']?.trim() || didKeyFromPublicJwk(keys.publicJwk);
  await writeFile(join(baseDir, DATA_DIR, 'did.json'), JSON.stringify(buildDidDocument(issuer, keys.publicJwk), null, 2) + '\n');
  const promptSha256 = await sha256Hex(SYSTEM_PROMPT);

  await mkdir(join(baseDir, MANIFESTS_DIR), { recursive: true });

  const entries: Entry[] = [];

  for (const seed of [...SEEDS, ...ORG_SPENDING_SEEDS]) {
    const unsigned = toUnsigned(seed);
    const isOrgAttested = unsigned.sourceClass === 'org_attested';

    // Every seed story must announce itself as composite in the published text,
    // not only in metadata a reader might never open.
    if (!unsigned.story.raw.startsWith(COMPOSITE_PREFIX)) {
      unsigned.story.raw = COMPOSITE_PREFIX + unsigned.story.raw;
    }

    let aiApplied = false;
    let model = 'none (pre-composed seed text)';
    let method = 'Shaped text was written by hand for the seed set; no model call was made.';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    // org_attested skips shaping entirely (src/add.ts does the same for live
    // submissions): the org's own disclosure text is the shaped text.
    if (options.useAi && !isOrgAttested) {
      const result = await transform({ raw: unsigned.story.raw, ask: unsigned.ask, zone: unsigned.zone });
      unsigned.story.shaped = result.shaped;
      aiApplied = true;
      model = result.model;
      method = 'Raw advocate text re-rendered by Claude under a no-fabrication system prompt.';
      usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    } else if (isOrgAttested) {
      method = 'org_attested entries are published as submitted, with no Claude shaping step, by design.';
    }

    // org_attested seeds sign under #56's isolated, non-pseudonymous org identity
    // key — never the platform key every other seed uses — the same isolation
    // guarantee a live org-spending-report submission gets via report-spending.ts.
    validateUnsigned(unsigned, isOrgAttested ? { assertingIdentity: unsigned.consent.advocateId } : {});
    const signingKeys = isOrgAttested ? await loadOrCreateOrgKeyPair(unsigned.consent.advocateId, baseDir) : keys;
    const entry = await signEntryCose(unsigned, signingKeys, { isOrgKey: !isOrgAttested });
    if (isOrgAttested) entry.provenance.signerTier = 'org_identity';
    entries.push(entry);

    const manifest = await buildManifest({
      entry,
      composite: true,
      aiTransform: {
        applied: aiApplied,
        model: aiApplied ? model : modelId() + ' (not invoked)',
        promptSha256,
        method,
        ...(usage ?? {}),
      },
    });

    await writeFile(
      join(baseDir, MANIFESTS_DIR, `${entry.id}.json`),
      JSON.stringify(manifest, null, 2) + '\n',
    );

  }

  await writeFile(join(baseDir, ENTRIES_PATH), JSON.stringify(entries, null, 2) + '\n');

  return {
    entries,
    entriesPath: ENTRIES_PATH,
    manifestsDir: MANIFESTS_DIR,
    aiApplied: options.useAi,
  };
}
