# Provider security and access

No provider workflow is production-ready until every human has an individual identity, a documented
role, least-privilege access, confidentiality obligations, and auditable actions.

## Required controls

- Individual accounts; no shared logins or shared “site cards.”
- MFA, short idle timeouts, session revocation, device protection, and immediate offboarding.
- Role and organization approval with supervisor, business need, expiration, and periodic recertification.
- Encryption in transit and at rest; signing and encryption keys separated, rotated, and revocable.
- No recovery secrets, DOB, ZIP, health details, or raw notes in logs or analytics.
- Append-only, tamper-evident audit events for reads, exports, edits, disclosures, permission changes,
  restores, failed logins, break-glass access, and key operations.
- Tested backups, deletion/retention controls, incident response, and accessibility.

## Suggested roles

An intake advocate can create and update assigned records; a provider responder sees routed asks and
records a response; a site operator maintains that site’s operational information; an auditor reviews
events but not recovery secrets; and a system administrator performs technical maintenance with
break-glass actions logged. No provider should silently mark a requester’s need complete.

## Evidence before launch

Record the owner, evidence, and review date for accounts/MFA, confidentiality training, offboarding,
encryption/key rotation, audit review, incident exercise, retention test, and lived-experience/accessibility
testing. If evidence is missing, keep the integration disabled.
