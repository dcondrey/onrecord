# Provider security and confidentiality baseline

This is the minimum production gate for an HMIS-aligned deployment. The demo provider card is not
proof of compliance.

## Provider access

- Every human gets an individual account; no shared site cards in production.
- Access is granted by role and organization, with least privilege and a documented business need.
- Suggested roles: intake advocate (create/update assigned records), provider responder (see only
  routed asks and file a response), site operator (publish that site’s operational counts), auditor
  (read audit events, not recovery secrets), and system administrator (technical maintenance, with
  break-glass logging). No role may silently resolve a requester’s claim.
- Require phishing-resistant MFA where supported, short idle timeouts, session revocation, device
  protection, and immediate offboarding when a person leaves.
- Before access, verify workforce identity, sign a confidentiality agreement, complete privacy/security
  training, and record organization, role, supervisor, approval, and expiration. Re-certify access
  periodically.

## Data safeguards

- Encrypt in transit with current TLS and at rest with managed keys. Keep signing keys and encryption
  keys separate; rotate and revoke them through a documented procedure.
- Store recovery verifier tags separately from operational identity data where practical. Never log
  recovery phrases, PINs, DOB, ZIP, or raw intake notes in application, analytics, or error logs.
- Apply field-level minimization, retention/deletion rules, backups, disaster recovery, and tested
  breach-response procedures.
- Keep an append-only, tamper-evident audit trail for reads, exports, creates, edits, disclosures,
  permission changes, failed logins, restores, break-glass access, and key operations. Include actor,
  organization, role, record, action, reason, timestamp, result, and correlation ID—but not secrets.

## Governance gate

Before connecting to an HMIS or real provider system, the operator must complete a security risk
assessment, data-sharing agreements, incident-response plan, retention schedule, user-access review,
and jurisdiction-specific legal/privacy review. The static demo must remain clearly labeled until those
controls exist.
