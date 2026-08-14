/**
 * The interactive prompt engine behind `on-record add` run with no flags at a
 * TTY. Branches by the selected Category: when DOMAIN_PAYLOAD_SCHEMAS (see
 * domain-payloads.ts) has a schema registered for it, collects and validates
 * that shape before returning. Every other category returns without a
 * domainPayload, same as today.
 *
 * The advocate/consent-method prompts sit after the (optional) domainPayload
 * collection and are identical in both branches — same loop, same question,
 * same rejection on a blank answer — so "one with a registered schema, one
 * without" reject a missing consent identically by construction, not by a
 * parallel check. This mirrors validateUnsigned()'s consent gate in
 * schema.ts, which is the actual hard gate; this module only avoids sending
 * an entry there with a blank advocate/consent already known-blank.
 *
 * Takes an injected `ask` rather than touching readline itself, so the whole
 * flow is exercisable from tests with a scripted ask() and no real TTY —
 * src/cli.ts is the only caller that wires it to a real terminal.
 */

import { ZONES, CATEGORIES, type Category, isZone, isCategory } from './schema.js';
import { DOMAIN_PAYLOAD_SCHEMAS, collectDomainPayload, type AskFn, type DomainPayloadSchema } from './domain-payloads.js';

export type { AskFn } from './domain-payloads.js';

export interface InteractiveAddPrefill {
  zone?: string;
  category?: string;
  summary?: string;
  amount?: string;
  advocateId?: string;
  consentMethod?: string;
}

export interface InteractiveAddResult {
  zone: string;
  category: string;
  summary?: string;
  amount?: string;
  advocateId: string;
  consentMethod: string;
  domainPayload?: { kind: string; data: Record<string, unknown> };
}

async function askChoice<T extends string>(ask: AskFn, label: string, options: readonly T[]): Promise<T> {
  const menu = options.map((o, i) => `    ${i + 1}. ${o}`).join('\n');
  for (;;) {
    const raw = (await ask(`  ${label}:\n${menu}\n  choose 1-${options.length} or type the name: `)).trim();
    const asIndex = Number(raw);
    if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= options.length) {
      return options[asIndex - 1] as T;
    }
    if ((options as readonly string[]).includes(raw)) return raw as T;
  }
}

async function askRequired(ask: AskFn, label: string): Promise<string> {
  for (;;) {
    const raw = (await ask(`  ${label}: `)).trim();
    if (raw) return raw;
  }
}

/**
 * Runs the full interactive prompt sequence. Any field already present in
 * `opts.prefill` (i.e. supplied on the command line) is used as-is and never
 * re-prompted — this lets a partially-flagged invocation
 * (e.g. `on-record add --zone Downtown`) only prompt for what's missing.
 */
export async function promptInteractiveAdd(
  ask: AskFn,
  opts: { prefill?: InteractiveAddPrefill; schemas?: Partial<Record<Category, DomainPayloadSchema>> } = {},
): Promise<InteractiveAddResult> {
  const schemas = opts.schemas ?? DOMAIN_PAYLOAD_SCHEMAS;
  const prefill = opts.prefill ?? {};

  const zone =
    prefill.zone !== undefined && isZone(prefill.zone) ? prefill.zone : await askChoice(ask, 'Zone', ZONES);
  const category =
    prefill.category !== undefined && isCategory(prefill.category)
      ? prefill.category
      : await askChoice(ask, 'Category', CATEGORIES);

  const summary =
    prefill.summary?.trim() ||
    (await ask('  Summary (optional, blank to auto-derive from the story): ')).trim() ||
    undefined;

  const amount = prefill.amount?.trim() || (await ask('  Amount in USD (optional): ')).trim() || undefined;

  // Branch point: only a category with a registered schema collects a domainPayload.
  // A schema's fields may themselves all be optional, so collectDomainPayload
  // can return data: {} — drop it rather than signing an empty domainPayload.
  const schema = isCategory(category) ? schemas[category] : undefined;
  const collected = schema ? await collectDomainPayload(schema, ask) : undefined;
  const domainPayload = collected && Object.keys(collected.data).length > 0 ? collected : undefined;

  // Consent gate. Mandatory in every branch — no path around it, and this is
  // the same two prompts regardless of whether a domainPayload was just
  // collected. validateUnsigned() in schema.ts is still the actual enforcement;
  // this only keeps an interactively-built input from reaching it pre-blanked.
  const advocateId =
    prefill.advocateId?.trim() ||
    (await askRequired(ask, 'Advocate ID (required — no entry is recorded without a named advocate)'));
  const consentMethod =
    prefill.consentMethod?.trim() ||
    (await askRequired(ask, 'Consent method (required, e.g. "verbal, in person, witnessed")'));

  return {
    zone,
    category,
    ...(summary ? { summary } : {}),
    ...(amount ? { amount } : {}),
    advocateId,
    consentMethod,
    ...(domainPayload ? { domainPayload } : {}),
  };
}

/**
 * Collects the raw story itself when neither --file nor a pipe supplied one
 * and stdin is a TTY: one line per prompt, terminated by a blank line.
 */
export async function promptRawStory(ask: AskFn): Promise<string> {
  const lines: string[] = [];
  let first = true;
  for (;;) {
    const prompt = first ? '  Raw story (finish with a blank line):\n  > ' : '  > ';
    first = false;
    const line = await ask(prompt);
    if (line === '') break;
    lines.push(line);
  }
  return lines.join('\n').trim();
}
