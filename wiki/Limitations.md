# Limitations and non-goals

**Read this before using, forking, or demonstrating the project.**

## Current limits

- No backend, production account service, durable provider identity, or authorization layer.
- Composite demo data only; no live clients, requests, shelter counts, or service guarantees.
- No public real-time bed inventory and no placement guarantee.
- Demo provider cards are not authentication and do not satisfy HMIS confidentiality controls.
- Browser keys and self-asserted timestamps are not a durable trust anchor or timestamp authority.
- Signatures prove integrity and key continuity, not truth, consent, fairness, authorization, or quality.
- AI shaping can misunderstand, omit nuance, or preserve an error; human review and raw text remain
  essential.

## Privacy limits

The public layer must not contain full names, DOBs, ZIP codes, health or victim-service information,
recovery material, immigration information, or precise locations. The familiar first-three-letters plus
date/ZIP pattern is guessable and is not strong authentication. A separate PIN, attempt limits,
non-revealing errors, and advocate-led restore are required for any real deployment.

Date normalization must show the result and ask for confirmation when month/day order or two-digit years
are ambiguous. An age floor validates a range; it does not prove identity.

## Non-goals

The project will not rank people’s worth, publish encampment locations, create punitive provider scores,
replace HMIS/coordinated entry, or turn a voluntary placard into legal permission.

## Stop conditions

Pause a pilot if a person is exposed, a recovery credential leaks, correction/withdrawal cannot be
honored, a precise location appears publicly, or staff use the prototype as an HMIS or shelter system.
Preserve minimum incident evidence, notify the privacy/security lead, and return to the last safe phase.

Canonical source: [docs/limitations.md](https://github.com/writerslogic/onrecord/blob/main/docs/limitations.md).
