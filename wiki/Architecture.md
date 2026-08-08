# Architecture

The project has three deliberately separated layers:

1. **Public static viewer:** a self-contained map of composite/de-identified data, with browser-side
   verification, service-directory references, structured offers, and no backend.
2. **Signing pipeline:** TypeScript CLI that validates consent and location boundaries, transforms raw
   notes under a no-fabrication prompt, signs deterministic JSON/CBOR, and emits COSE/DID provenance.
3. **Future private service layer:** an encrypted, access-controlled API for real intake, provider
   workflows, moderation, and audit events. It does not exist in the current demo.

See [docs/protocol.md](https://github.com/writerslogic/onrecord/blob/main/docs/protocol.md) for the signed format and [docs/limitations.md](https://github.com/writerslogic/onrecord/blob/main/docs/limitations.md)
for what the current system cannot prove.
