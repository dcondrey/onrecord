/**
 * SMS intake gateway (#17, part of #14): a Twilio-style webhook
 * (application/x-www-form-urlencoded POST with `Body` and `From`) that lets
 * a contributor text in a witnessed street-level observation without ever
 * touching the org's signing key or the advocate-consent path.
 *
 * `From` resolves to a pseudonymous contributor identity — a signing key
 * isolated under keys/contributors/ (contributor-identity.ts) and a public
 * pseudonym derived the same deterministic way, so the same sender always
 * signs and is attributed consistently without their number ever being
 * persisted. The resulting entry is sourceClass: 'self_attested_witness'
 * (schema.ts) and is held in data/pending-review.json — never appended to
 * data/entries.json — until a human reviews it; there is no publish path
 * for this sidecar yet (that's outside #17's scope).
 *
 * No provider-signature check (e.g. Twilio's X-Twilio-Signature) on the
 * webhook itself — out of scope for #17, and not a substitute for it if added
 * later: the guarantee here is that whatever a request claims as `From` gets
 * its own isolated key and pseudonym and never reaches data/entries.json
 * unreviewed, not that the request came from a trusted carrier.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { parseIntakeFields } from '../intake-form.js';
import { addEntry, AddEntryError, type AddEntryInput, type AddEntryOutput } from '../add.js';
import { ValidationError, ZONES, CATEGORIES, type Zone, type Category } from '../schema.js';
import { deriveContributorPseudonym, loadOrCreateContributorKeyPair } from './contributor-identity.js';
import { DATA_DIR } from '../seed.js';
import { enqueueIntake } from '../intake-queue.js';
import { readBody } from '../http-body.js';
import type { transform } from '../transform.js';

export const PENDING_REVIEW_PATH = join(DATA_DIR, 'pending-review.json');

// SMS carries no structured zone/category, only free text and a sender. Zone/
// Category may be supplied as extra form fields by a future keyword-routing
// front end; absent or unrecognized, every report defaults here rather than
// in validateUnsigned(), which has no concept of a default, only a valid
// value. This is a guess, not a fact the record now claims to know — the
// entry still sits in data/pending-review.json, unpublished, until a human
// reviewer sees (and can correct) the actual zone/category before it ever
// reaches data/entries.json.
const DEFAULT_ZONE: Zone = 'Downtown';
const DEFAULT_CATEGORY: Category = 'shelter_bed';

export interface PendingReviewRecord {
  entry: AddEntryOutput['entry'];
  manifest: AddEntryOutput['manifest'];
  submittedAtISO: string;
}

async function readPendingReview(): Promise<PendingReviewRecord[]> {
  return existsSync(PENDING_REVIEW_PATH)
    ? (JSON.parse(await readFile(PENDING_REVIEW_PATH, 'utf8')) as PendingReviewRecord[])
    : [];
}

function respondText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(body);
}

export async function handleSmsWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { transform?: typeof transform } = {},
): Promise<void> {
  let fields: Record<string, string>;
  try {
    const body = await readBody(req);
    if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
      respondText(res, 415, 'expected application/x-www-form-urlencoded');
      return;
    }
    fields = parseIntakeFields(body);
  } catch (err) {
    respondText(res, 413, err instanceof Error ? err.message : String(err));
    return;
  }

  const from = fields['From']?.trim();
  const raw = fields['Body']?.trim();
  if (!from) return respondText(res, 400, 'missing From');
  if (!raw) return respondText(res, 400, 'missing Body');

  const zoneField = fields['Zone']?.trim();
  const categoryField = fields['Category']?.trim();
  const zone = zoneField && (ZONES as readonly string[]).includes(zoneField) ? zoneField : DEFAULT_ZONE;
  const category =
    categoryField && (CATEGORIES as readonly string[]).includes(categoryField) ? categoryField : DEFAULT_CATEGORY;

  // Routed through the same chain as /api/add (see intake-queue.ts): both do a
  // read-modify-write across a multi-second Claude call, so they must share one
  // serialization point, not one each.
  const task = enqueueIntake(async () => {
    const contributorKeys = await loadOrCreateContributorKeyPair(from);
    const pseudonym = await deriveContributorPseudonym(from);

    const input: AddEntryInput = {
      raw,
      zone,
      category,
      advocateId: pseudonym,
      consentMethod: 'self-attested via SMS',
      sourceClass: 'self_attested_witness',
    };

    const output = await addEntry(input, {
      keys: contributorKeys,
      assertingIdentity: pseudonym,
      holdForReview: true,
      ...(deps.transform ? { transform: deps.transform } : {}),
    });

    const pending = await readPendingReview();
    pending.push({ entry: output.entry, manifest: output.manifest, submittedAtISO: new Date().toISOString() });
    // addEntry() with holdForReview never creates DATA_DIR itself (that only
    // happens on the org did.json write path, deliberately skipped for a
    // contributor key) — so this is the first write that might need it.
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(PENDING_REVIEW_PATH, JSON.stringify(pending, null, 2) + '\n');
    return output;
  });

  try {
    await task;
    // TwiML, so a real Twilio webhook doesn't error on the response body; no
    // auto-reply text is sent back to the sender.
    res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' }).end('<Response></Response>');
  } catch (err) {
    const message =
      err instanceof AddEntryError || err instanceof ValidationError
        ? err.message
        : err instanceof Error
          ? `could not accept this submission: ${err.message}`
          : 'could not accept this submission';
    respondText(res, 400, message);
  }
}
