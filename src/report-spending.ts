/**
 * Org spending disclosure intake (#57, part of #54).
 *
 * Unlike cmdAdd's interactive per-ask flow, an org disclosure has no underlying
 * personal ask to attach to — it's an organization disclosing about itself, not
 * an advocate relaying someone else's request. So this builds a minimal
 * synthetic Entry directly (ask.category is the spending category itself,
 * ask.summary a short disclosure description) and signs it under #56's isolated,
 * non-pseudonymous org identity key, the same reuse-addEntry()-with-a-different-
 * key pattern the SMS gateway (src/gateway/sms.ts) uses for contributor keys.
 *
 * Self-attestation by the disclosure's own subject is a different case from
 * CLAUDE.md's "unsourced org claims never sign" rule (cmdAdd's --org-claim
 * without --source): that rule guards a THIRD PARTY's unsourced claim about an
 * organization from being signed as if verified. Here the org is the one
 * signing, under its own isolated key, about its own spending — there is no
 * third party to source the claim from, and the signature only ever attests
 * "this org asserted this," identical to what every other sourceClass already
 * means. It is not exempted from that rule; it was never inside its scope.
 */

import { isCategory, isZone, CATEGORIES, ZONES } from './schema.js';
import { addEntry, AddEntryError, type AddEntryOutput } from './add.js';
import { loadOrCreateOrgKeyPair } from './gateway/org-identity.js';

export interface ReportSpendingInput {
  orgName: string;
  zone: string;
  category: string;
  /** Raw string, same convention as AddEntryInput.amount: parsed and range-checked here. */
  amount: string;
  /** Reporting period, e.g. "2026-Q3". Free text — no enum, since a period's shape
   *  (quarter, month, fiscal year) is the disclosing org's choice, not this schema's. */
  period: string;
  /** The org's own disclosure text — becomes both story.raw and story.shaped, since
   *  org_attested entries skip the Claude shaping step (src/add.ts) entirely. */
  disclosureText: string;
  reportedAt?: string;
  summary?: string;
  id?: string;
}

function fail(msg: string): never {
  throw new AddEntryError(msg);
}

export async function reportSpending(
  input: ReportSpendingInput,
  opts: { onStatus?: (msg: string) => void } = {},
): Promise<AddEntryOutput> {
  const orgName = input.orgName.trim();
  if (!orgName) fail('an org name is required.');

  const zone = input.zone;
  if (!isZone(zone)) fail(`unknown zone "${zone}". One of: ${ZONES.join(', ')}`);

  const category = input.category;
  if (!isCategory(category)) fail(`unknown category "${category}". One of: ${CATEGORIES.join(', ')}`);

  const amountUsd = Number(input.amount);
  if (!Number.isFinite(amountUsd) || amountUsd < 0) fail('amount must be a non-negative number');

  const period = input.period.trim();
  if (!period) fail('a reporting period is required, e.g. --period "2026-Q3".');

  const disclosureText = input.disclosureText.trim();
  if (!disclosureText) fail('disclosure text is required — the org\'s own account of this spending.');

  const reportedAtISO = input.reportedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(reportedAtISO))) fail('reportedAt must be a valid ISO 8601 timestamp');

  const orgKeys = await loadOrCreateOrgKeyPair(orgName);

  return addEntry(
    {
      raw: disclosureText,
      zone,
      category,
      // Not "requested"/"unanswered": a disclosure has nothing pending a response,
      // and addEntry() defaults to 'requested' when status is omitted, which would
      // misread every disclosure as an open, unmet ask on the Accountability tab.
      status: 'answered',
      summary: input.summary?.trim() || `${period} ${category} spending disclosure`,
      advocateId: orgName,
      consentMethod: 'org self-disclosure',
      consentAt: reportedAtISO,
      sourceClass: 'org_attested',
      id: input.id,
      domainPayload: {
        kind: 'org_spending_report',
        data: { orgName, zone, category, amountUsd, period, reportedAtISO },
      },
    },
    {
      keys: orgKeys,
      assertingIdentity: orgName,
      ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
    },
  );
}
