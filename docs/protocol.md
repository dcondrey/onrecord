# The On Record protocol

How an entry is canonicalized, hashed, signed, and wrapped in a provenance manifest — and what that
does and does not prove.

The whole design constraint is that a browser must be able to re-verify an entry using nothing but
`crypto.subtle`, offline, with no library. That rules out DER parsing, JOSE, COSE, and full C2PA, and
it is why the scheme below is as small as it is.

## 1. The entry

An entry is defined in [`src/schema.ts`](../src/schema.ts):

```ts
interface Entry {
  id: string;
  zone: Zone;             // neighborhood only — never coordinates
  ask: { category: Category; summary: string; amountUsd?: number };
  story: { raw: string; shaped: string };
  consent: { advocateId: string; method: string; timestampISO: string };
  status: Status;
  provenance: Provenance; // added by signing; excluded from the signed payload
}
```

Two schema-level rules are enforced rather than documented:

**No precise location.** `assertNoPreciseLocation()` walks the entry recursively and refuses any key
named `lat`, `lng`, `lon`, `latitude`, `longitude`, `coords`, `coordinates`, `geo`, `address`, or
`gps`, at any depth. Publishing where a specific unhoused person sleeps is a safety problem, so the
field has no home in the format at all.

**Consent or nothing.** `validateUnsigned()` refuses an entry lacking `consent.advocateId`,
`consent.method`, or a parseable `consent.timestampISO`. There is no placeholder and no default. A
system that permits skipping consent will be used to skip consent.

## 2. Canonicalization

`canonicalize(entry)` rebuilds the object field by field, in the exact order declared in the schema,
omitting `provenance`, then `JSON.stringify`s it.

It does **not** stringify the caller's object directly. V8 preserves insertion order, so an entry
parsed back from a file could serialize to different bytes than the one that was signed, and the
signature would fail for no real reason. Rebuilding makes the byte sequence a function of the schema
alone.

Optional fields are omitted when absent and never emitted as `null`, so an entry with no
`ask.amountUsd` hashes identically whether the key was missing or explicitly `undefined`.

> [!WARNING]
> **Key order in `schema.ts` is load-bearing.** Reordering, renaming, or inserting a field changes
> the canonical bytes and therefore invalidates every signature ever produced. A schema change is a
> re-signing event, not a refactor.

## 3. Hashing and signing

```
canonical = canonicalize(entry)                    # UTF-8 string
digest    = SHA-256(utf8(canonical))               # 32 raw bytes
signature = ECDSA-P256-SHA256(digest)              # signed over the DIGEST BYTES
```

The signature is computed over the digest bytes, not over the canonical string. This lets a verifier
answer two questions independently:

1. **Did the content change?** Recompute the digest and compare it to `contentHash`.
2. **Was this key the signer?** Check the signature against the digest and `pubKey`.

A tampered entry fails (1) and (2) distinctly, which is what lets the map show *what* broke rather
than a single opaque red X.

### Encodings

| Field | Encoding |
|---|---|
| `contentHash` | lowercase hex of the 32-byte digest |
| `signature` | base64 of the raw 64-byte IEEE P-1363 `r‖s` pair — what WebCrypto emits, **not** DER |
| `pubKey` | base64 of the SPKI DER public key |
| `keyFingerprint` | first 8 bytes of `SHA-256(pubKey)`, hex — display only, not a security boundary |

The provenance block written onto the entry:

```json
{
  "alg": "ECDSA-P256",
  "contentHash": "20c431a5…",
  "signature": "JxSqDXxB…",
  "pubKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…",
  "manifestVersion": "1.0",
  "signedAtISO": "2026-08-07T02:36:57.698Z"
}
```

## 4. The provenance manifest

Alongside each entry, `buildManifest()` writes `data/manifests/<id>.json` — C2PA-*shaped* rather
than C2PA-conformant (see [Limits](#6-what-this-does-not-prove)). Assertions:

| Label | What it records |
|---|---|
| `org.onrecord.consent` | advocate id, consent method, timestamp, recorded-before-publication |
| `org.onrecord.story.hash` | SHA-256 of both `raw` and `shaped`, and that both are published |
| `c2pa.actions` | `c2pa.edited` / `c2pa.created` with the IPTC `digitalSourceType` and the software agent |
| `org.onrecord.ai-transform` | whether a model ran, which model, `SHA-256` of the system prompt, and the constraint text |
| `org.onrecord.location-precision` | granularity `zone`, and a note that no coordinates exist |
| `org.onrecord.composite` | present only on seed data — marks the entry as not a real individual |
| `org.onrecord.org-claim` | a dollar claim against an organization — **signed only when a source is supplied** |

Hashing the system prompt matters: it means "an AI shaped this" is not a vague disclosure. Anyone
holding the prompt text can prove which set of constraints the model was operating under, and a
changed prompt produces a different hash on every subsequent entry.

### The unsourced-claim guardrail

An organization-directed claim with no `--source` is never signed. It is written to a separate
`unsignedNotes` array, flagged `alleged: true` and `excludedFromSignedAssertions: true`, with the
reason recorded. The cryptography deliberately refuses to lend authority to an accusation nobody
sourced — the seal covers what is checkable, not what is merely asserted.

## 5. Verification

`on-record verify` re-derives everything from scratch: it re-canonicalizes each entry, recomputes
the digest, imports `pubKey` from the entry itself, and checks the signature. It does not trust
`contentHash` as given.

The browser does the same with WebCrypto, which is why the map works offline. It also means the
public key ships *inside* every entry — verification proves internal consistency and non-tampering,
not authorization. See below.

## 6. What this does not prove

Being precise about the boundary is the point of the exercise:

- **The public key travels with the entry.** Anyone can generate a keypair and sign a fabricated
  entry that verifies perfectly. This proves *this content has not changed since this key signed it*
  — not *this key is allowed to make entries*. A real deployment needs published, pinned keys (a
  `did:web` document or a JWKS endpoint) so a verifier checks the fingerprint against a known
  issuer.
- **`signedAtISO` is self-asserted.** There is no timestamp authority and no transparency log, so
  the signing time is a claim by the signer, not evidence. Backdating is undetectable. RFC 3161
  timestamps or a SCITT log would fix this.
- **No revocation.** A compromised key cannot be retired; every entry it ever signed keeps verifying.
- **This is not C2PA.** It borrows the manifest shape and the `c2pa.actions` label, but there is no
  COSE signing, no certificate chain, no trust list, and no hard binding to a media asset. Do not
  hand these manifests to a C2PA validator and expect them to parse.
- **The consent gate is a schema gate.** It proves an advocate id and a method string were recorded.
  It cannot prove consent was actually obtained — nothing in software can. That remains a human
  obligation.
- **Truthfulness is out of scope entirely.** A signature says the bytes are unmodified. It says
  nothing about whether the account they encode is accurate.

## 7. Threat model

| Adversary | Attempts | Outcome |
|---|---|---|
| Passive reader | Edits a published entry to change the ask or the story | Digest mismatch — the map shows the seal broken and the pin turns red |
| Publisher | Quietly rewrites history after the fact | Same. Any change to a signed field is visible; re-signing shows a new `signedAtISO` |
| Publisher | Ships shaped text without the raw text it came from | Structurally impossible — `story.raw` is a required signed field and both are published |
| Publisher | Launders an unsourced accusation through the seal | Refused — unsourced org claims are excluded from signed assertions by construction |
| Publisher | Hides that a model was involved | The `ai-transform` assertion and the prompt hash are inside the signed manifest |
| Forger | Fabricates an entry with their own keypair | **Succeeds** — key pinning is the missing control, see §6 |
| Forger | Backdates an entry | **Succeeds** — no timestamp authority, see §6 |
| Deanonymizer | Recovers where an individual sleeps | Zone granularity only; coordinate-bearing keys are refused at validation |

## References

- [C2PA specification](https://c2pa.org/specifications/specifications/2.1/index.html) — the manifest
  and assertion vocabulary this borrows from
- [IPTC digital source type](https://cv.iptc.org/newscodes/digitalsourcetype/) — the controlled
  vocabulary for `algorithmicallyEnhanced` / `digitalCapture`
- [RFC 6979](https://www.rfc-editor.org/rfc/rfc6979) / [SEC 1](https://www.secg.org/sec1-v2.pdf) —
  ECDSA and the P-1363 `r‖s` signature form
- [WebCrypto `SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto) — the
  only verification dependency in the browser
