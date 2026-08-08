# Deployment roadmap

The safe sequence is **composite prototype → governed pilot → private service layer → controlled
interoperability → measured expansion**. A working demo is not evidence that a production service is safe.

## Gate 0: prototype (current)

Use synthetic data, static hosting, signed fixtures, and explicit limitations. Keep the demo offline and
clearly labeled. Do not accept real client, HMIS, provider, or recovery data.

## Gate 1: governed pilot

Before intake, create a lived-experience advisory group; approve a plain-language privacy notice and
consent/read-back script; choose one narrow use case; define retention, correction, withdrawal, moderation,
accessibility, and incident rules; and test paper cards, borrowed phones, kiosks, screen readers, and low
bandwidth. Use volunteered or synthetic data only.

## Gate 2: private service layer

Add an encrypted API/database, individual workforce identity, phishing-resistant MFA where possible,
RBAC/ABAC, least privilege, session revocation, moderation queues, rate limits, abuse reporting,
advocate restoration, key rotation/revocation, backups, disaster recovery, and append-only audit review.
No provider may silently resolve a requester’s claim.

## Gate 3: controlled interoperability

Execute data-sharing agreements and a permitted-use matrix. Map the minimum fields to the current HUD
HMIS standards and CoC dictionary. Keep victim-service workflows separate where VAWA/FVPSA or other
confidentiality rules apply. Require freshness, provenance, authorization, and rollback for operational
feeds. Never publish a placement guarantee.

## Gate 4: measured expansion

Expand document recovery, transportation, mutual aid, and verified responses only after safety review.
Publish context-rich aggregate outcomes, correction paths, appeal statistics, and independent audit
summaries. Stop or narrow any feature that increases surveillance, stigma, exposure, or staff burden.

Canonical source: [docs/roadmap.md](https://github.com/writerslogic/onrecord/blob/main/docs/roadmap.md).
