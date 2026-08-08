# Deployment roadmap

The project should move in deliberate gates. A working demo is not evidence that a production service
is safe.

## Phase 0 — prototype (current)

- Composite data only; static GitHub Pages viewer.
- Deterministic JSON/CBOR, COSE_Sign1, did:key foundations, signed manifests, and browser verification.
- Structured offers and provider claims are demonstrations, not real routing.
- Privacy, HMIS boundary, security, limitations, and audience guides are published.

## Phase 1 — governed pilot

- Form a community advisory group including people with lived experience, advocates, providers, and a
  privacy/security lead.
- Approve the privacy notice, consent script, data inventory, retention schedule, abuse policy,
  accessibility standard, and incident response plan.
- Select one narrow use case: advocate-mediated document-replacement requests and mutual-aid offers.
- Use synthetic or volunteered pilot data; do not import HMIS client records yet.
- Run usability sessions with people using borrowed phones, kiosks, screen readers, and paper cards.

## Phase 2 — private service layer

- Deploy an API and encrypted database separated from the public static map.
- Add individual workforce identity, MFA, RBAC/ABAC, least privilege, session revocation, and durable
  append-only audit events.
- Add moderation queues, rate limits, abuse reports, content redaction, provider acknowledgement/defer/
  decline workflows, and advocate restoration.
- Establish key custody, rotation, revocation, DID/JWKS pinning, backups, disaster recovery, and
  independent penetration/privacy testing.

## Phase 3 — controlled interoperability

- Execute data-sharing agreements with the CoC, providers, and any HMIS/coordinated-entry operator.
- Map only the minimum protected fields to the applicable current HUD HMIS Data Standards release.
- Keep victim-service workflows separate where VAWA/FVPSA or other confidentiality rules require it.
- Use freshness, provenance, and authorization metadata for any operational provider feed. Never publish
  a public placement guarantee or duplicate a shelter’s authoritative inventory workflow.

## Phase 4 — measured expansion

- Expand mutual aid, document replacement, transportation, and verified provider responses only after
  safety review.
- Report response visibility with context, not punitive provider rankings.
- Publish aggregate outcomes, correction paths, community feedback, and independent audit summaries.
- Reassess whether the system is reducing friction for people living outdoors; stop or narrow features
  that increase surveillance, stigma, or exposure.
