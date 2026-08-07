/**
 * PLACEHOLDER — pipeline smoke-test data.
 *
 * This file is owned by the parallel scaffolding pass (see CODEX_TASK.md) and is
 * expected to be replaced with the full set of 10 composite records covering all
 * 8 zones and all 7 ask categories. These 3 exist so the sign/verify pipeline can
 * be exercised end-to-end before that lands.
 *
 * Every record here is a composite illustration assembled from patterns in public
 * reporting on unhoused people in San Diego. None of them is a real individual,
 * and the composite label appears in the published story text itself — not only
 * in metadata a reader might never open.
 */

export interface SeedRecord {
  id: string;
  zone: string;
  ask: { category: string; summary: string; amountUsd?: number };
  story: { raw: string; shaped: string };
  consent: { advocateId: string; method: string; timestampISO: string };
  status: string;
}

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
  },
];
