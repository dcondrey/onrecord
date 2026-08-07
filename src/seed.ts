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
import { SEEDS, type SeedRecord } from './seeds.data.js';
import {
  isCategory,
  isStatus,
  isZone,
  validateUnsigned,
  ValidationError,
  type Entry,
  type UnsignedEntry,
} from './schema.js';
import { buildManifest, loadOrCreateKeyPair, sha256Hex, signEntryCose } from './sign.js';
import { SYSTEM_PROMPT, modelId, transform } from './transform.js';
import { buildDidDocument, didKeyFromPublicJwk } from './did.js';

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

  for (const seed of SEEDS) {
    const unsigned = toUnsigned(seed);

    // Every seed story must announce itself as composite in the published text,
    // not only in metadata a reader might never open.
    if (!unsigned.story.raw.startsWith(COMPOSITE_PREFIX)) {
      unsigned.story.raw = COMPOSITE_PREFIX + unsigned.story.raw;
    }

    let aiApplied = false;
    let model = 'none (pre-composed seed text)';
    let method = 'Shaped text was written by hand for the seed set; no model call was made.';
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    if (options.useAi) {
      const result = await transform({ raw: unsigned.story.raw, ask: unsigned.ask, zone: unsigned.zone });
      unsigned.story.shaped = result.shaped;
      aiApplied = true;
      model = result.model;
      method = 'Raw advocate text re-rendered by Claude under a no-fabrication system prompt.';
      usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    }

    validateUnsigned(unsigned);
    const entry = await signEntryCose(unsigned, keys);
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
