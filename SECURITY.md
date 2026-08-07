# Security Policy

## Supported Versions

On Record is pre-1.0 and under active development. Security fixes are applied to `main`; there is no
long-term support branch.

| Version | Supported |
|---------|-----------|
| `main`  | ✅        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Open a private advisory via
[GitHub Security Advisories](https://github.com/writerslogic/onrecord/security/advisories/new), or
email **admin@writerslogic.com**.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (do **not** include a real private signing key or a real `.env`)
- The affected surface (the browser map, the CLI, the signing scheme, or the manifest format)

You can expect an initial response within a few days. Coordinated disclosure is appreciated; please
give us a reasonable window to ship a fix before publishing details.

## Especially valuable reports

The project's whole claim is that a reader can check the record without trusting the publisher.
Anything that undermines that is in scope:

- **Signature or canonicalization bypass** — two distinct entries that produce the same canonical
  bytes, or a tampered entry that still verifies.
- **Verifier divergence** — content the browser verifier accepts but `on-record verify` rejects, or
  vice versa. The two must agree; a gap between them is exploitable.
- **Privacy leaks** — any path by which a coordinate, street address, shelter name, or other
  precise-location value survives `assertNoPreciseLocation()` and reaches a published entry.
- **Consent-gate bypass** — any path that writes an entry with an empty, whitespace, or absent
  advocate id or consent method.
- **Unsourced-claim laundering** — any way an organization-directed claim without a source ends up
  inside the *signed* assertions rather than `unsignedNotes`.
- **Network egress from the map** — the page claims zero network requests and enforces it with a
  `default-src 'none'` CSP. Any request that escapes that is a vulnerability, not a bug.
- **Key exposure** — anything that could cause a private signing key to be written outside `keys/`,
  logged, printed, or committed.

## Known limitations (not vulnerabilities)

These are documented design boundaries, described in [docs/protocol.md](./docs/protocol.md#6-what-this-does-not-prove).
Reports restating them are welcome as discussion, but they are already known:

- The public key ships inside each entry, so a forger with their own keypair can produce an entry
  that verifies. There is no key pinning or trust list yet.
- `signedAtISO` is self-asserted. There is no timestamp authority, so backdating is undetectable.
- There is no key revocation.
- The format is C2PA-*shaped*, not C2PA-conformant — no COSE signing and no certificate chain.
- A signature proves bytes are unmodified. It proves nothing about whether the account is true.

## Handling of keys and secrets

The private signing key lives in `keys/signing-key.json`, which is git-ignored and must never be
committed — anyone holding it can forge entries under your identity. `ANTHROPIC_API_KEY` belongs in
`.env` (also git-ignored), never in a commit, an issue, or a manifest. If you believe a key in this
repository's history has been exposed, report it privately rather than opening an issue.
