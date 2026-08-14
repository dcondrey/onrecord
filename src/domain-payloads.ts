/**
 * Registry + prompt collection for `Entry.domainPayload` (src/schema.ts's
 * `DomainPayload` — the open escape hatch added in #20). A `DomainPayloadSchema`
 * is a per-`Category` shape declaration: what fields the interactive `add`
 * flow (src/cli.ts's `cmdAdd`) should collect for that category, and how to
 * type-check them before they become `domainPayload.data`.
 *
 * This module owns per-field type checking only. `validateUnsigned()` in
 * schema.ts still runs its own generic domainPayload check (kind non-empty,
 * data is a plain object) plus `assertNoPreciseLocation()` over the whole
 * entry including domainPayload.data — that gate is never bypassed here, and
 * this module adds no exception to it. A schema whose field is literally
 * named "address" (or any other forbidden key) still gets refused downstream,
 * by the same gate every other field goes through.
 *
 * DOMAIN_PAYLOAD_SCHEMAS ships empty. Future categories (#29 rental price
 * reporting, #30 self-reported homelessness counts) register themselves here;
 * this file only builds the mechanism they plug into.
 */

import { type Category, isCategory } from './schema.js';

export interface DomainPayloadFieldSpec {
  /** Key written into domainPayload.data. */
  name: string;
  /** Prompt text shown to the advocate. */
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
}

export interface DomainPayloadSchema {
  /** Written into domainPayload.kind verbatim, e.g. "org.onrecord.rent/v1". */
  kind: string;
  fields: DomainPayloadFieldSpec[];
}

/** Category -> registered schema. Empty until a future issue registers one. */
export const DOMAIN_PAYLOAD_SCHEMAS: Partial<Record<Category, DomainPayloadSchema>> = {};

export function schemaForCategory(
  category: string,
  registry: Partial<Record<Category, DomainPayloadSchema>> = DOMAIN_PAYLOAD_SCHEMAS,
): DomainPayloadSchema | undefined {
  return isCategory(category) ? registry[category] : undefined;
}

export class DomainPayloadInputError extends Error {
  override readonly name = 'DomainPayloadInputError';
}

/** Caller-supplied prompt function: shows `question`, returns the raw answer. */
export type AskFn = (question: string) => Promise<string>;

const MAX_ATTEMPTS_PER_FIELD = 20;

function coerce(field: DomainPayloadFieldSpec, raw: string): { ok: true; value: unknown } | { ok: false } {
  if (field.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
  }
  if (field.type === 'boolean') {
    const lower = raw.toLowerCase();
    if (['y', 'yes', 'true'].includes(lower)) return { ok: true, value: true };
    if (['n', 'no', 'false'].includes(lower)) return { ok: true, value: false };
    return { ok: false };
  }
  return { ok: true, value: raw };
}

/**
 * Prompts for and validates every field in `schema`, one at a time, via the
 * injected `ask`. Re-prompts on a type mismatch or a blank required field;
 * an optional field left blank is simply omitted from `data` (never written
 * as null — same convention canonicalize() uses for every other optional
 * field). Bails after MAX_ATTEMPTS_PER_FIELD bad answers to one field rather
 * than looping forever against a broken or non-interactive `ask`.
 */
export async function collectDomainPayload(
  schema: DomainPayloadSchema,
  ask: AskFn,
): Promise<{ kind: string; data: Record<string, unknown> }> {
  const data: Record<string, unknown> = {};
  for (const field of schema.fields) {
    let attempts = 0;
    for (;;) {
      attempts++;
      if (attempts > MAX_ATTEMPTS_PER_FIELD) {
        throw new DomainPayloadInputError(`too many invalid answers for "${field.label}"; giving up.`);
      }
      const suffix = field.required ? '' : ' (optional)';
      const typeHint = field.type === 'boolean' ? ' [y/n]' : '';
      const raw = (await ask(`  ${field.label}${suffix}${typeHint}: `)).trim();
      if (!raw) {
        if (field.required) continue;
        break;
      }
      const coerced = coerce(field, raw);
      if (!coerced.ok) continue;
      data[field.name] = coerced.value;
      break;
    }
  }
  return { kind: schema.kind, data };
}
