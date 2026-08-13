# Limitations and non-goals

**Status:** prototype boundary · **Owner:** project maintainers · **Review before every pilot**

On Record is a prototype for consented, de-identified requests and verifiable provenance. It is not
an HMIS, coordinated-entry system, shelter-placement system, case-management system, emergency service,
legal service, medical record, or crisis line.

## What the current demo cannot do

- It has no backend, account service, durable provider identity, or production authorization layer.
- The map contains composite demonstration records, not live clients or live requests.
- It has no public real-time shelter-bed feed. Capacity references and demo counts are not placement
  signals. Call providers or coordinated-entry hubs directly.
- Browser-generated keys and local interaction seals are not a durable trust anchor. They do not prove
  that a publisher is an authorized agency.
- Demo provider cards are intentionally not compliant authentication. They do not provide MFA,
  individual workforce identity, confidentiality attestation, or durable audit storage.
- The public artifact must not receive names, DOB, ZIP, health information, victim-service information,
  precise locations, or other protected client data.
- Cryptographic signatures prove byte integrity and signer-key continuity; they do not prove truth,
  consent, authorization, fairness, or service quality.
- AI shaping can preserve an error, misunderstand context, or omit meaningful nuance. Human review and
  the original note remain necessary.

## Operational risks

An anonymous or accountless return path can be guessed, cards can be lost, public material can be
misused, and providers can be overwhelmed. Rate limits, advocate restoration, moderation, abuse
response, accessibility testing, and trauma-informed governance are required before real use.

The three-letter-name/date/ZIP pattern is familiar in some outreach settings, but it is not a secret
and may be guessable. Treat it as a convenience locator, never as strong authentication, and use a
separate PIN alongside it.

That PIN is a 4-digit code (`recovery.verifierTag` in `src/recovery.ts`, PBKDF2-derived, published
in plaintext in every signed entry so the scheme stays fully offline-verifiable — no server is
consulted to check it). "Limit attempts" and "avoid revealing whether a guess matched" are not
available mitigations for it: there is no request path to rate-limit or to keep silent on, since
anyone holding the entry file and the public first3/last3/DOB/ZIP fields can brute-force all 10,000
PINs offline, on their own machine, in well under a minute. Advocate-led restore remains available,
but attempt-limiting is not — do not represent it as a real mitigation in a pilot's risk writeup.
Where a person could face retaliation, stalking, or coercion, do not use `claim-card/identity-v1` at
all: use the phrase-based `claim-card/v1` scheme instead (a random multi-word phrase plus PIN, high
enough entropy that offline brute-forcing the same way is not practical), and steer higher-risk real
deployments toward it as the default.

When month/day order or two-digit years are ambiguous, the operator must show the normalized date and
obtain explicit confirmation. An age floor is a validation rule, not proof of identity.

## Non-goals

This project will not rank the worthiness of people, publish encampment locations, expose individual
provider performance as a punitive score, or replace HMIS/coordinated-entry privacy controls with a
public dashboard.

## Release rule

Do not connect real client data or a real provider system until the deployment roadmap, privacy notice,
security baseline, data-sharing agreements, threat model, incident plan, retention rules, and an
independent privacy/security review are complete.

## Stop conditions

Pause a pilot if a person is exposed, a recovery credential is disclosed, correction/withdrawal cannot
be honored, a public view reveals a precise location, or staff use the prototype as HMIS or shelter
placement. Preserve only the minimum incident evidence, notify the privacy/security lead, and return to
the last safe phase in [the roadmap](./roadmap.md).
