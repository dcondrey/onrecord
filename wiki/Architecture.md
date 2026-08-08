# Architecture

The system is intentionally split into three trust zones. The current repository implements the first
two; the third is a future production project.

## 1. Public static viewer

The viewer is a self-contained page for composite demonstration records. It renders neighborhood-level
information, shows raw and shaped text together, and verifies an entry in the browser with WebCrypto.
It has no login, backend, live provider feed, analytics, map tiles, or real client records. A green seal
means “these bytes match this embedded key,” not “this claim is true” or “this agency approved it.”

## 2. Signing pipeline

The TypeScript CLI validates the schema and consent fields, rejects precise-location keys, applies a
disclosed no-fabrication transformation when configured, and signs deterministic payloads. New records
use JSON plus deterministic CBOR and detached COSE_Sign1 ES256. A `did:key` can provide self-contained
key continuity; a future `did:web` can point to a controlled issuer document. C2PA is opt-in for a real
asset supplied by an operator; the ledger does not generate PNGs or attach media to text records.

### Verification boundaries

- Hash: detects changed bytes.
- COSE/ECDSA: checks a signature made by the embedded key.
- DID document: can bind a key to a pinned issuer, when independently retrieved and checked.
- C2PA: can bind provenance to a supported asset when a trusted certificate and asset are present.

None of these proves truth, consent, identity, service quality, or authorization by itself.

## 3. Future private service layer

Real intake, recovery, moderation, provider routing, workforce accounts, MFA, role/attribute-based
access, encryption, key custody, retention, correction, deletion, and append-only audit events belong
behind an authenticated API and encrypted database. Protected HMIS/coordinated-entry and victim-service
records must remain in their governed systems or a separately approved protected workflow.

## Data flow for a safe pilot

`person ↔ advocate intake → consent/read-back → private record → de-identified public projection`

`provider offer → moderation/routing → requester confirmation → aggregate outcome`

The public projection must never be the system of record for identity or case management.

Canonical technical detail: [docs/protocol.md](https://github.com/writerslogic/onrecord/blob/main/docs/protocol.md).
