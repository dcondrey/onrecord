/**
 * Composite sample set for the sign/verify pipeline and the demo map.
 *
 * Covers all 8 ZONES and all 7 CATEGORIES from src/schema.ts at least once —
 * a contributor adding a zone or category there should extend this set too,
 * so the map's filters and dashboards have something to show for it rather
 * than an empty bucket.
 *
 * Every record here is a composite illustration assembled from patterns in public
 * reporting on unhoused people in San Diego. None of them is a real individual,
 * and the composite label appears in the published story text itself — not only
 * in metadata a reader might never open.
 */

import type { DomainPayload } from './schema.js';

export interface SeedRecord {
  id: string;
  zone: string;
  ask: { category: string; summary: string; amountUsd?: number };
  story: { raw: string; shaped: string };
  consent: { advocateId: string; method: string; timestampISO: string };
  status: string;
  shelterStatus?: {
    bedStatus: string;
    estimatedOpenings?: number;
    restrictions: {
      allowsCanines: boolean;
      allowsWeaponsStorage: boolean;
      requiresCleanScreen: boolean;
      hasHardCurfew: boolean;
      curfewTime?: string;
    };
    storagePolicy: string;
    safetyVolatility: string;
  };
  /** #55: only 'org_attested' seeds use this — runSeed() (seed.ts) signs those under
   *  an isolated org identity key (#56) instead of the platform key. */
  sourceClass?: string;
  /** #57: org_spending_report fixtures. zone/category here must match the record's
   *  own zone/ask.category — validateUnsigned() enforces it. */
  domainPayload?: DomainPayload;
}

/**
 * #57/#58/#59 fixtures: org spending disclosures. Deliberately uneven across
 * zones/categories/amounts/periods and deliberately leaving Downtown, Balboa Park,
 * Chula Vista, and El Cajon with zero disclosed spending despite carrying asks
 * above — #59's needs-vs-spending dashboard has nothing to surface a gap with
 * otherwise, and #58's choropleth needs a real intensity spread to render.
 */
export const ORG_SPENDING_SEEDS: SeedRecord[] = [
  {
    id: 'or_org_seed_01',
    zone: 'La Mesa',
    ask: { category: 'shelter_bed', summary: '2026-Q2 shelter_bed spending disclosure', amountUsd: 180000 },
    story: {
      raw: 'Example Shelter Fund disclosed $180,000 in shelter_bed spending in La Mesa for 2026-Q2, covering bed nights and intake staffing at two partner sites.',
      shaped: 'Example Shelter Fund disclosed $180,000 in shelter_bed spending in La Mesa for 2026-Q2, covering bed nights and intake staffing at two partner sites. (Composite illustration.)',
    },
    consent: { advocateId: 'Example Shelter Fund', method: 'org self-disclosure', timestampISO: '2026-07-01T09:00:00Z' },
    status: 'answered',
    sourceClass: 'org_attested',
    domainPayload: {
      kind: 'org_spending_report',
      data: { orgName: 'Example Shelter Fund', zone: 'La Mesa', category: 'shelter_bed', amountUsd: 180000, period: '2026-Q2', reportedAtISO: '2026-07-01T09:00:00Z' },
    },
  },
  {
    id: 'or_org_seed_02',
    zone: 'La Mesa',
    ask: { category: 'shelter_bed', summary: '2026-Q1 shelter_bed spending disclosure', amountUsd: 30000 },
    story: {
      raw: 'Example Shelter Fund disclosed $30,000 in shelter_bed spending in La Mesa for 2026-Q1, a partial-quarter figure ahead of the Q2 program ramp-up.',
      shaped: 'Example Shelter Fund disclosed $30,000 in shelter_bed spending in La Mesa for 2026-Q1, a partial-quarter figure ahead of the Q2 program ramp-up. (Composite illustration.)',
    },
    consent: { advocateId: 'Example Shelter Fund', method: 'org self-disclosure', timestampISO: '2026-04-02T09:00:00Z' },
    status: 'answered',
    sourceClass: 'org_attested',
    domainPayload: {
      kind: 'org_spending_report',
      data: { orgName: 'Example Shelter Fund', zone: 'La Mesa', category: 'shelter_bed', amountUsd: 30000, period: '2026-Q1', reportedAtISO: '2026-04-02T09:00:00Z' },
    },
  },
  {
    id: 'or_org_seed_03',
    zone: 'East Village',
    ask: { category: 'id_documents', summary: '2026-Q3 id_documents spending disclosure', amountUsd: 4200 },
    story: {
      raw: 'Bayview Housing Collective disclosed $4,200 in id_documents spending in East Village for 2026-Q3, covering birth certificate and state ID fee waivers referred through partner intake.',
      shaped: 'Bayview Housing Collective disclosed $4,200 in id_documents spending in East Village for 2026-Q3, covering birth certificate and state ID fee waivers referred through partner intake. (Composite illustration.)',
    },
    consent: { advocateId: 'Bayview Housing Collective', method: 'org self-disclosure', timestampISO: '2026-08-01T09:00:00Z' },
    status: 'answered',
    sourceClass: 'org_attested',
    domainPayload: {
      kind: 'org_spending_report',
      data: { orgName: 'Bayview Housing Collective', zone: 'East Village', category: 'id_documents', amountUsd: 4200, period: '2026-Q3', reportedAtISO: '2026-08-01T09:00:00Z' },
    },
  },
  {
    id: 'or_org_seed_04',
    zone: 'Ocean Beach',
    ask: { category: 'transit', summary: '2026-Q3 transit spending disclosure', amountUsd: 9500 },
    story: {
      raw: 'Coastal Transit Access Fund disclosed $9,500 in transit spending in Ocean Beach for 2026-Q3, funding monthly regional transit passes for referred riders.',
      shaped: 'Coastal Transit Access Fund disclosed $9,500 in transit spending in Ocean Beach for 2026-Q3, funding monthly regional transit passes for referred riders. (Composite illustration.)',
    },
    consent: { advocateId: 'Coastal Transit Access Fund', method: 'org self-disclosure', timestampISO: '2026-08-05T09:00:00Z' },
    status: 'answered',
    sourceClass: 'org_attested',
    domainPayload: {
      kind: 'org_spending_report',
      data: { orgName: 'Coastal Transit Access Fund', zone: 'Ocean Beach', category: 'transit', amountUsd: 9500, period: '2026-Q3', reportedAtISO: '2026-08-05T09:00:00Z' },
    },
  },
];

export const SEEDS: SeedRecord[] = [
  {
    id: 'or_seed_01',
    zone: 'East Village',
    ask: { category: 'id_documents', summary: 'replacement CA state ID', amountUsd: 39 },
    story: {
      raw: '[COMPOSITE — not a real individual] wallet taken while he slept, back in march. says he cant get the ID without the birth certificate and cant get the birth certificate without the ID. been in that loop 5 months. hes tired of explaining it to people. was a line cook before.',
      shaped:
        'My wallet was taken while I was sleeping back in March. To replace my ID I need my birth certificate, and to get the birth certificate I need my ID. I have been going in that circle for five months. I used to work as a line cook. I am tired of explaining this to people. (Composite illustration.)',
    },
    consent: {
      advocateId: 'adv_ecv_014',
      method: 'verbal, in person, witnessed by outreach partner',
      timestampISO: '2026-07-14T18:22:00Z',
    },
    status: 'requested',
  },
  {
    id: 'or_seed_02',
    zone: 'Ocean Beach',
    ask: { category: 'transit', summary: 'monthly transit pass to reach a job site in Kearny Mesa' },
    story: {
      raw: '[COMPOSITE — not a real individual] got hired on at a warehouse in kearny mesa, starts in two weeks. the commute is the problem — two buses each way and she cant cover the pass until the first check clears. she was very matter of fact about it, no drama.',
      shaped:
        'I have been hired at a warehouse in Kearny Mesa and I start in two weeks. The problem is getting there: it is two buses each way, and I cannot cover a pass until my first check clears. (Composite illustration.)',
    },
    consent: {
      advocateId: 'adv_ob_003',
      method: 'written, signed intake form',
      timestampISO: '2026-06-30T15:05:00Z',
    },
    status: 'answered',
  },
  {
    id: 'or_seed_03',
    zone: 'Downtown',
    ask: { category: 'shelter_bed', summary: 'shelter bed, ground floor if possible' },
    story: {
      raw: '[COMPOSITE — not a real individual] turned away twice now, says the beds were full both times. knee is bad so stairs are hard, hes asking for ground floor if theres any. been sleeping behind a store off broadway. no one has followed up with him since may.',
      shaped:
        'I have been turned away twice; both times I was told the beds were full. My knee is bad, so stairs are hard — I am asking for a ground floor bed if there is one. I have been sleeping behind a store off Broadway. No one has followed up with me since May. (Composite illustration.)',
    },
    consent: {
      advocateId: 'adv_dtn_027',
      method: 'verbal, recorded with permission',
      timestampISO: '2026-05-19T20:41:00Z',
    },
    status: 'unanswered',
    shelterStatus: {
      bedStatus: 'turning_away',
      estimatedOpenings: 0,
      restrictions: {
        allowsCanines: false,
        allowsWeaponsStorage: false,
        requiresCleanScreen: true,
        hasHardCurfew: true,
        curfewTime: '19:00',
      },
      storagePolicy: 'backpack_only',
      safetyVolatility: 'moderate',
    },
  },
  {
    id: 'or_seed_04',
    zone: 'Balboa Park',
    ask: { category: 'medical', summary: 'refill of an existing blood pressure prescription' },
    story: {
      raw: '[COMPOSITE — not a real individual] blood pressure meds ran out three weeks ago, been getting dizzy standing up fast. went to the free clinic near the park twice, both times the wait list was full for new patients. says he just needs someone to see him once and write the same prescription again.',
      shaped:
        "My blood pressure medication ran out three weeks ago, and I've been getting dizzy when I stand up quickly. I went to the free clinic near the park twice, and both times the new-patient waitlist was full. I don't need anything new — just someone to see me once and refill the same prescription. (Composite illustration.)",
    },
    consent: {
      advocateId: 'adv_bp_009',
      method: 'verbal, in person, witnessed by clinic outreach worker',
      timestampISO: '2026-07-01T10:15:00Z',
    },
    status: 'acknowledged',
  },
  {
    id: 'or_seed_05',
    zone: 'Hillcrest',
    ask: { category: 'work_docs', summary: 'food handler card before a Monday restaurant shift', amountUsd: 11 },
    story: {
      raw: '[COMPOSITE — not a real individual] got offered a job at a restaurant on university ave, they need a food handler card before her first shift monday. says she has the ten dollars but not a way to get online long enough to finish the course and print the card.',
      shaped:
        'I was offered a job at a restaurant on University Avenue, and I need a food handler card before my first shift on Monday. I have the ten dollars for the course, but not reliable enough internet access to finish it and print the card in time. (Composite illustration.)',
    },
    consent: {
      advocateId: 'adv_hc_042',
      method: 'written, signed intake form',
      timestampISO: '2026-07-22T09:40:00Z',
    },
    status: 'requested',
  },
  {
    id: 'or_seed_06',
    zone: 'Chula Vista',
    ask: { category: 'phone', summary: 'a phone to reach a case worker about a housing voucher' },
    story: {
      raw: '[COMPOSITE — not a real individual] phone got taken in a fight at the shelter, cant call the case worker back or check on the housing voucher application. says he missed one callback already because there was no way to reach him.',
      shaped:
        "My phone was taken in a fight at the shelter. I can't call my case worker back or check on my housing voucher application, and I already missed one callback because there was no way to reach me. (Composite illustration.)",
    },
    consent: {
      advocateId: 'adv_cv_018',
      method: 'verbal, in person, witnessed by shelter staff',
      timestampISO: '2026-06-11T16:50:00Z',
    },
    status: 'unanswered',
  },
  {
    id: 'or_seed_07',
    zone: 'El Cajon',
    ask: { category: 'childcare', summary: 'childcare for the morning of a warehouse job interview' },
    story: {
      raw: '[COMPOSITE — not a real individual] has an interview lined up at a warehouse but no one to watch her three year old that morning, says her sister used to help but moved to arizona in the spring. missing the interview means waiting another month for the next opening.',
      shaped:
        "I have a job interview lined up at a warehouse, but no one to watch my three-year-old that morning. My sister used to help, but she moved to Arizona this spring. If I miss the interview, the next opening isn't for another month. (Composite illustration.)",
    },
    consent: {
      advocateId: 'adv_ec_031',
      method: 'verbal, recorded with permission',
      timestampISO: '2026-07-30T08:05:00Z',
    },
    status: 'requested',
  },
  {
    id: 'or_seed_08',
    zone: 'La Mesa',
    ask: { category: 'shelter_bed', summary: 'any available shelter bed, no location preference' },
    story: {
      raw: "[COMPOSITE — not a real individual] been on the coordinated entry list since february, keeps getting told hes close but nothing opens up. cold at night now, says he'd take anything with four walls at this point, doesnt care about location.",
      shaped:
        "I have been on the coordinated entry list since February. I keep getting told I'm close, but nothing opens up. It's cold at night now — I would take anything with four walls at this point; I don't care about location. (Composite illustration.)",
    },
    consent: {
      advocateId: 'adv_lm_006',
      method: 'written, signed intake form',
      timestampISO: '2026-04-28T19:30:00Z',
    },
    status: 'unanswered',
    shelterStatus: {
      bedStatus: 'full',
      estimatedOpenings: 0,
      restrictions: {
        allowsCanines: false,
        allowsWeaponsStorage: true,
        requiresCleanScreen: false,
        hasHardCurfew: false,
      },
      storagePolicy: 'cart_allowed',
      safetyVolatility: 'low',
    },
  },
  {
    id: 'or_seed_09',
    zone: 'East Village',
    ask: { category: 'shelter_bed', summary: 'an open bed reported for tonight, first-come basis' },
    story: {
      raw: '[COMPOSITE — not a real individual] outreach worker called ahead and confirmed two beds open tonight, no waitlist right now. says the front desk stops taking new intakes at 9, and they do a breathalyzer at the door, no exceptions.',
      shaped:
        'An outreach worker called ahead and confirmed two beds are open tonight, with no waitlist right now. The front desk stops taking new intakes at 9pm, and there is a breathalyzer check at the door with no exceptions. (Composite illustration.)',
    },
    consent: {
      advocateId: 'adv_ev_051',
      method: 'verbal, in person, witnessed by outreach worker',
      timestampISO: '2026-08-02T21:10:00Z',
    },
    status: 'acknowledged',
    shelterStatus: {
      bedStatus: 'open',
      estimatedOpenings: 2,
      restrictions: {
        allowsCanines: false,
        allowsWeaponsStorage: false,
        requiresCleanScreen: true,
        hasHardCurfew: true,
        curfewTime: '21:00',
      },
      storagePolicy: 'secure_lockers',
      safetyVolatility: 'low',
    },
  },
];
