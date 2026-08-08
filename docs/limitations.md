# Limitations and non-goals

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

## Non-goals

This project will not rank the worthiness of people, publish encampment locations, expose individual
provider performance as a punitive score, or replace HMIS/coordinated-entry privacy controls with a
public dashboard.

## Release rule

Do not connect real client data or a real provider system until the deployment roadmap, privacy notice,
security baseline, data-sharing agreements, threat model, incident plan, retention rules, and an
independent privacy/security review are complete.
