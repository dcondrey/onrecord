/**
 * On Record — shared entry schema.
 *
 * This file is the contract between this backend and the self-contained HTML
 * Artifact that renders the map. Key order below is LOAD-BEARING: canonicalize()
 * serializes fields in exactly this order, and the SHA-256 of that serialization
 * is what gets signed. Reordering a field here breaks every existing signature.
 */

export const ZONES = [
  'Downtown',
  'East Village',
  'Balboa Park',
  'Hillcrest',
  'Ocean Beach',
  'Chula Vista',
  'El Cajon',
  'La Mesa',
] as const;
export type Zone = (typeof ZONES)[number];

export const CATEGORIES = [
  'id_documents',
  'shelter_bed',
  'medical',
  'work_docs',
  'phone',
  'transit',
  'childcare',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATUSES = ['requested', 'acknowledged', 'answered', 'unanswered'] as const;
export type Status = (typeof STATUSES)[number];

export interface Ask {
  category: Category;
  summary: string;
  amountUsd?: number;
}

export interface Story {
  raw: string;
  shaped: string;
}

export interface Consent {
  advocateId: string;
  method: string;
  timestampISO: string;
}

export interface Recovery {
  scheme: 'claim-card/v1' | 'claim-card/identity-v1';
  verifierTag: string;
}

export const BED_STATUSES = ['open', 'full', 'turning_away', 'unknown'] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

export const STORAGE_POLICIES = ['none', 'backpack_only', 'cart_allowed', 'secure_lockers'] as const;
export type StoragePolicy = (typeof STORAGE_POLICIES)[number];

export const SAFETY_LEVELS = ['low', 'moderate', 'high'] as const;
export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

export interface ShelterRestrictions {
  allowsCanines: boolean;
  allowsWeaponsStorage: boolean;
  requiresCleanScreen: boolean;
  hasHardCurfew: boolean;
  /** Only meaningful, and only allowed, when hasHardCurfew is true. */
  curfewTime?: string;
}

/**
 * A single witnessed observation of shelter conditions at intake time — not a
 * live feed. Only valid on entries whose ask.category is 'shelter_bed'.
 */
export interface ShelterStatus {
  bedStatus: BedStatus;
  estimatedOpenings?: number;
  restrictions: ShelterRestrictions;
  storagePolicy: StoragePolicy;
  safetyVolatility: SafetyLevel;
}

export interface Provenance {
  alg: 'ECDSA-P256' | 'COSE-ES256';
  contentHash: string;
  /** Legacy v1 raw P-1363 signature. Absent for protocol v2. */
  signature?: string;
  pubKey: string;
  manifestVersion: '1.0' | '1.1' | '1.2';
  signedAtISO: string;
  /** Standards envelope, present on protocol v2 entries. */
  protocolVersion?: '1.0' | '2.0';
  issuer?: string;
  verificationMethod?: string;
  cborPayload?: string;
  coseSign1?: string;
  /** Org key vs. isolated per-handle contributor key (src/gateway/contributor-identity.ts). Provenance is outside canonicalize()'s input, so this carries no key-order constraint. */
  signerTier?: 'org' | 'contributor';
}

/**
 * Who is asserting this entry's contents. 'advocate_attested' (the default,
 * implicit when absent) is the CLI's original trust model: a named advocate
 * vouching for someone else's account. 'self_attested_witness' is a
 * contributor vouching for their own witnessed account — validateUnsigned()
 * requires consent.advocateId to equal that contributor's own gateway
 * pseudonym in that case, so a contributor can't claim third-party advocate
 * authority they don't have. 'self_attested_personal' shares that same
 * self-consent mechanism but is not a lower-trust crowd signal: it's an
 * unhoused person publishing their own story/ask under their own
 * contributor identity, with no advocate mediating, and it renders with
 * full normal map-marker treatment rather than web/index.html's Street
 * Pulse tier (which matches only 'self_attested_witness').
 */
export const SOURCE_CLASSES = ['advocate_attested', 'self_attested_witness', 'self_attested_personal'] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

export interface Entry {
  id: string;
  zone: Zone;
  ask: Ask;
  story: Story;
  consent: Consent;
  sourceClass?: SourceClass;
  recovery?: Recovery;
  shelterStatus?: ShelterStatus;
  status: Status;
  provenance: Provenance;
}

/** An entry before it has been signed. */
export type UnsignedEntry = Omit<Entry, 'provenance'>;

// --- canonicalization -------------------------------------------------------

/**
 * Deterministic JSON for the signable payload: every field EXCEPT `provenance`,
 * emitted in the exact key order declared in the schema, recursively.
 *
 * We do not use JSON.stringify(obj) directly on the caller's object because V8
 * key order depends on insertion order — an entry rebuilt from a parsed file
 * could serialize differently than the one we signed. Rebuilding the object
 * field-by-field here makes the byte sequence a function of the schema alone.
 *
 * Optional fields are omitted when absent (never emitted as null), so an entry
 * with no amountUsd hashes identically whether the key was missing or undefined.
 */
export function canonicalize(entry: UnsignedEntry): string {
  const ask: Record<string, unknown> = {
    category: entry.ask.category,
    summary: entry.ask.summary,
  };
  if (entry.ask.amountUsd !== undefined) ask['amountUsd'] = entry.ask.amountUsd;

  const ordered = {
    id: entry.id,
    zone: entry.zone,
    ask,
    story: {
      raw: entry.story.raw,
      shaped: entry.story.shaped,
    },
    consent: {
      advocateId: entry.consent.advocateId,
      method: entry.consent.method,
      timestampISO: entry.consent.timestampISO,
    },
    ...(entry.sourceClass ? { sourceClass: entry.sourceClass } : {}),
    ...(entry.recovery ? { recovery: { scheme: entry.recovery.scheme, verifierTag: entry.recovery.verifierTag } } : {}),
    ...(entry.shelterStatus
      ? {
          shelterStatus: {
            bedStatus: entry.shelterStatus.bedStatus,
            ...(entry.shelterStatus.estimatedOpenings !== undefined
              ? { estimatedOpenings: entry.shelterStatus.estimatedOpenings }
              : {}),
            restrictions: {
              allowsCanines: entry.shelterStatus.restrictions.allowsCanines,
              allowsWeaponsStorage: entry.shelterStatus.restrictions.allowsWeaponsStorage,
              requiresCleanScreen: entry.shelterStatus.restrictions.requiresCleanScreen,
              hasHardCurfew: entry.shelterStatus.restrictions.hasHardCurfew,
              ...(entry.shelterStatus.restrictions.curfewTime !== undefined
                ? { curfewTime: entry.shelterStatus.restrictions.curfewTime }
                : {}),
            },
            storagePolicy: entry.shelterStatus.storagePolicy,
            safetyVolatility: entry.shelterStatus.safetyVolatility,
          },
        }
      : {}),
    status: entry.status,
  };

  return JSON.stringify(ordered);
}

// --- validation -------------------------------------------------------------

export class ValidationError extends Error {
  override readonly name = 'ValidationError';
}

function fail(msg: string): never {
  throw new ValidationError(msg);
}

/** Keys that must never appear anywhere in an entry. Zones only — never coordinates. */
const FORBIDDEN_KEYS = new Set([
  'lat',
  'lng',
  'lon',
  'latitude',
  'longitude',
  'coords',
  'coordinates',
  'geo',
  'address',
  'gps',
]);

export function assertNoPreciseLocation(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPreciseLocation(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
      fail(
        `precise-location field "${path}.${k}" is not allowed. On Record stores zones only, never coordinates or street addresses.`,
      );
    }
    assertNoPreciseLocation(v, `${path}.${k}`);
  }
}

export function isZone(v: string): v is Zone {
  return (ZONES as readonly string[]).includes(v);
}

export function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

export function isStatus(v: string): v is Status {
  return (STATUSES as readonly string[]).includes(v);
}

export function isBedStatus(v: string): v is BedStatus {
  return (BED_STATUSES as readonly string[]).includes(v);
}

export function isStoragePolicy(v: string): v is StoragePolicy {
  return (STORAGE_POLICIES as readonly string[]).includes(v);
}

export function isSafetyLevel(v: string): v is SafetyLevel {
  return (SAFETY_LEVELS as readonly string[]).includes(v);
}

export function isSourceClass(v: string): v is SourceClass {
  return (SOURCE_CLASSES as readonly string[]).includes(v);
}

export interface ValidateUnsignedContext {
  /** The submitting contributor's own gateway pseudonym, when known — checked against
   *  consent.advocateId for sourceClass: 'self_attested_witness' entries below. */
  contributorPseudonym?: string;
}

/**
 * Validates an unsigned entry. Consent is the hard gate: an entry with no
 * advocate, no stated consent method, or no consent timestamp is refused
 * outright rather than written with a placeholder.
 */
export function validateUnsigned(entry: UnsignedEntry, ctx: ValidateUnsignedContext = {}): void {
  assertNoPreciseLocation(entry);

  if (!entry.id || typeof entry.id !== 'string') fail('id is required');
  // id is interpolated directly into a filesystem path (data/manifests/<id>.json)
  // in add.ts, export.ts, and withdraw.ts — an id like "../../../../tmp/evil"
  // would write or delete files outside data/manifests/ via path.join's
  // arithmetic collapsing of ".." segments. Restricting the charset here closes
  // that off at the one place every write and read path already calls through.
  if (!/^[a-zA-Z0-9_-]+$/.test(entry.id)) {
    fail('id may only contain letters, digits, hyphens, and underscores');
  }
  if (!isZone(entry.zone)) fail(`zone must be one of: ${ZONES.join(', ')}`);
  if (!isCategory(entry.ask.category)) fail(`ask.category must be one of: ${CATEGORIES.join(', ')}`);
  if (!entry.ask.summary?.trim()) fail('ask.summary is required');
  if (entry.ask.amountUsd !== undefined) {
    if (!Number.isFinite(entry.ask.amountUsd) || entry.ask.amountUsd < 0) {
      fail('ask.amountUsd must be a non-negative number');
    }
  }
  if (!entry.story.raw?.trim()) fail('story.raw is required');
  if (!entry.story.shaped?.trim()) fail('story.shaped is required');
  if (!isStatus(entry.status)) fail(`status must be one of: ${STATUSES.join(', ')}`);

  // Consent gate.
  if (!entry.consent.advocateId?.trim()) {
    fail('CONSENT REQUIRED: --advocate is missing. No entry is recorded without a named advocate.');
  }
  if (!entry.consent.method?.trim()) {
    fail(
      'CONSENT REQUIRED: --consent-method is missing. Record how consent was given (e.g. "verbal, in person, witnessed").',
    );
  }
  if (!entry.consent.timestampISO || Number.isNaN(Date.parse(entry.consent.timestampISO))) {
    fail('CONSENT REQUIRED: consent.timestampISO must be a valid ISO 8601 timestamp.');
  }

  if (entry.sourceClass !== undefined && !isSourceClass(entry.sourceClass)) {
    fail(`sourceClass must be one of: ${SOURCE_CLASSES.join(', ')}`);
  }
  // A contributor vouching for their own witnessed account can't also claim to be
  // vouching for someone else — consent.advocateId must be their own pseudonym.
  if (entry.sourceClass === 'self_attested_witness') {
    const pseudonym = ctx.contributorPseudonym?.trim();
    if (!pseudonym) {
      fail('self_attested_witness entries require a contributor pseudonym from the gateway.');
    }
    if (entry.consent.advocateId.trim() !== pseudonym) {
      fail('self_attested_witness entries must have consent.advocateId equal to the contributing pseudonym.');
    }
  }
  // Same self-consent mechanism as self_attested_witness above, but for a person
  // publishing their own story/ask rather than a third-party witness observation.
  if (entry.sourceClass === 'self_attested_personal') {
    const pseudonym = ctx.contributorPseudonym?.trim();
    if (!pseudonym) {
      fail('self_attested_personal entries require a contributor pseudonym from the gateway.');
    }
    if (entry.consent.advocateId.trim() !== pseudonym) {
      fail('self_attested_personal entries must have consent.advocateId equal to the contributing pseudonym.');
    }
  }

  if (entry.shelterStatus) {
    if (entry.ask.category !== 'shelter_bed') {
      fail('shelterStatus is only valid when ask.category is "shelter_bed"');
    }
    const s = entry.shelterStatus;
    if (!isBedStatus(s.bedStatus)) fail(`shelterStatus.bedStatus must be one of: ${BED_STATUSES.join(', ')}`);
    if (s.estimatedOpenings !== undefined) {
      if (!Number.isFinite(s.estimatedOpenings) || s.estimatedOpenings < 0) {
        fail('shelterStatus.estimatedOpenings must be a non-negative number');
      }
    }
    if (!isStoragePolicy(s.storagePolicy)) {
      fail(`shelterStatus.storagePolicy must be one of: ${STORAGE_POLICIES.join(', ')}`);
    }
    if (!isSafetyLevel(s.safetyVolatility)) {
      fail(`shelterStatus.safetyVolatility must be one of: ${SAFETY_LEVELS.join(', ')}`);
    }
    if (s.restrictions.curfewTime !== undefined && !s.restrictions.hasHardCurfew) {
      fail('shelterStatus.restrictions.curfewTime may only be set when hasHardCurfew is true');
    }
  }
}

/** Parses an arbitrary JSON value into an Entry, or throws. Used by the verifier. */
export function parseEntry(value: unknown, index: number): Entry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`entries[${index}] is not an object`);
  }
  const e = value as Partial<Entry>;
  if (!e.provenance) fail(`entries[${index}] has no provenance block`);
  if (!e.story || !e.ask || !e.consent) fail(`entries[${index}] is missing required fields`);
  return e as Entry;
}
