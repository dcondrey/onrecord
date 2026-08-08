<!-- On Record: a signed, self-verifying public ledger of requests from unhoused people. Landing README. -->

# On Record

### A public ledger of requests that can't be quietly edited

Every entry is signed. Every AI transform is disclosed. The page verifies<br>
itself in your browser — offline, with zero network requests.

<p align="center">
  <a href="https://github.com/writerslogic/onrecord/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/writerslogic/onrecord/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/writerslogic/onrecord/actions/workflows/pages.yml"><img alt="Pages" src="https://github.com/writerslogic/onrecord/actions/workflows/pages.yml/badge.svg"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/writerslogic/onrecord"><img alt="OpenSSF Scorecard" src="https://api.securityscorecards.dev/projects/github.com/writerslogic/onrecord/badge"></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.7-blue.svg"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <a href="https://orcid.org/0009-0003-1849-2963"><img alt="ORCID" src="https://img.shields.io/badge/ORCID-0009--0003--1849--2963-green.svg"></a>
</p>

<p align="center">
  <b>Promises are cheap. Proof is checkable.</b><br>
  A map of San Diego where each request carries a cryptographic seal you can break yourself.<br>
  <a href="https://writerslogic.github.io/onrecord/"><b>Live demo →</b></a> <sub>(no login, no backend — composite data)</sub>
</p>

> [!IMPORTANT]
> **Every story in this repository is a composite.** No entry describes a real, identifiable
> individual, and dollar figures shown against institutions are illustrative placeholders, not
> sourced claims about any real agency or budget. See [Ethics](#ethics-and-the-data-in-this-repo).

On Record is two things that fit together. The **map** (`web/index.html`) is one self-contained HTML
file: it renders San Diego by neighborhood, shows what people have asked for, and lets any visitor
check the signature on every entry — then deliberately *break* one and watch the seal fail. The
**CLI** (`src/`) is the pipeline that produces those entries: it takes an advocate's raw notes,
passes them through a disclosed Claude transform that is forbidden from inventing anything, signs
the result with ECDSA P-256, and writes a C2PA-style provenance manifest alongside it.

The point is a system where the claim and the evidence for the claim travel together. An entry that
has been altered says so. An entry shaped by a model says that too, in the record, permanently.

## Quick start

```sh
git clone https://github.com/writerslogic/onrecord.git
cd onrecord
python3 -m http.server 8080 --directory web
```

Open <http://localhost:8080/>. Nothing else is required — no build, no dependencies, no API key. The
map generates its own signing key in the browser on load.

To work with the signing pipeline instead:

```sh
npm install
npm run build
npm run seed          # write the composite sample set to data/
npm run verify        # independently re-check every signature
```

## What you can do on the map

- **Pick a neighborhood, then a pin.** Each pin is one request: an ID replacement, a shelter bed, a
  prescription, a work document.
- **Read it two ways.** Every story shows *their words* (the raw note) and the *AI-shaped* version
  side by side. You are never shown the shaped text without access to what it came from.
- **Verify.** The key chip turns green when the browser's key is sealed; hitting verify re-computes
  the SHA-256 of the canonical entry and checks the ECDSA signature — in your browser, with
  WebCrypto.
- **Tamper.** Change a stored entry and the pin turns red, the seal breaks, and the failure is
  legible. Restore puts it back.
- **Guide me.** A self-driving walkthrough runs the whole arc and ends on the non-response rate.

## How the proof works

The scheme is deliberately small so a browser can re-verify it with `crypto.subtle` and nothing else:

```
canonical = canonicalize(entry without its provenance block)   # fixed key order
digest    = SHA-256(utf8(canonical))                           # 32 bytes
signature = ECDSA-P256-SHA256(digest)                          # over the digest bytes
```

`contentHash` is the lowercase hex of that digest. `signature` is base64 of the raw 64-byte
IEEE P-1363 `r||s` pair — what WebCrypto emits, not DER. `pubKey` is base64 SPKI DER. A verifier
therefore answers two independent questions: *did the content change* (the hash), and *was this key
the signer* (the signature).

New entries also carry a protocol-v2 envelope: deterministic CBOR, detached COSE_Sign1 ES256, and a
publisher DID (`did:web` when `ONRECORD_ISSUER_DID` is configured, otherwise a self-contained
`did:key`). Existing v1 JSON/ECDSA entries remain readable and verifiable.

The accountless recovery path is the product’s primary identity mechanism. The preferred intake flow
matches the needle-exchange pattern staff already know, without collecting a full name: the first
three letters of the first name, the first three letters of the last name, date of birth, ZIP code,
and a short PIN. Use `--first3 abc --last3 xyz --dob YYYY-MM-DD --zip 92101 --recovery-pin 4417`; only a
PBKDF2/HMAC verifier tag is stored in the signed entry. Nothing identifying is written to the
ledger, and the card works from any borrowed device. The identity fields are a memorable locator,
not a substitute for in-person restore when a card is lost. A random four-or-more-word phrase
(`--recovery-phrase`) remains available when an organization needs a non-PII credential.

The CLI verifier is authoritative for protocol-v2 records. The self-contained demo viewer currently
renders its embedded composite demo dataset and uses its own legacy interaction seals; it is not a
network client and does not silently claim to validate the CLI’s v2 envelope.

Key order in `src/schema.ts` is load-bearing. `canonicalize()` serializes fields in exactly that
order, so reordering a field there invalidates every signature ever produced. Full format,
manifest structure, and threat model: **[docs/protocol.md](./docs/protocol.md)**.

## Privacy and provider security

The accountless recovery design does not remove privacy obligations. A production deployment must
show the person a plain-language [privacy notice](./docs/privacy-notice.md) before intake, minimize
what is collected, and explain use, disclosure, retention, correction, withdrawal, and complaints.
Provider access must be individual, role-based, least-privilege, MFA-protected, approved after
confidentiality training/agreement, encrypted, and recorded in append-only audit logs. The required
[provider security baseline](./docs/security-and-provider-policy.md) is the implementation gate for
connecting this project to an HMIS or real service system. The static viewer’s provider cards are
deliberately demo-only and are not compliant authentication.
See [HMIS alignment boundary](./docs/hmis-alignment.md) for the public/private split, evolving HUD
data standards, and VAWA-sensitive provider workflows.
The product’s intended operating model is documented in [docs/operating-model.md](./docs/operating-model.md):
support and verified routing before punitive provider scoring, with integration rather than duplicate
bed-entry workflows.

## The AI step, and its limits

`on-record add` sends the advocate's raw note to Claude with a system prompt (`src/transform.ts`)
whose entire job is subtraction, not addition. It may fix transcription noise, drop identifying
detail, and remove an advocate's editorializing. It may not add a fact, soften the truth, add hope
the person did not express, or make a claim about any organization. If the raw note is too sparse to
shape without inventing, the correct output is the raw note nearly unchanged.

Both `raw` and `shaped` are stored and both are published, and the transform is recorded as an
assertion in the provenance manifest. The model is a participant in the record, not a ghostwriter
hiding behind it.

## CLI

```
on-record add    [--file <path>] --zone <zone> --category <cat> --summary <text>
                 [--amount <usd>] --advocate <id> --consent-method <text>
                 [--consent-at <iso>] [--status <status>] [--id <id>]
                 [--first3 <3 letters> --last3 <3 letters> --dob <flexible date>
                  --confirm-dob <YYYY-MM-DD> --zip <5 digits> --recovery-pin <4 digits>]
                 [--recovery-phrase "four or more words" --recovery-pin <4 digits>]
                 [--org-claim <text>] [--source <text>] [--json]
                 (raw story is read from stdin when --file is omitted)

on-record verify [<file>] [--did-doc <path>] [--json]    independently re-check every signature
on-record seed   [--force] [--ai]     write the composite sample set
on-record serve  [--port <n>]         serve the local viewer
on-record keys                        show the signing key in use
```

`--advocate` and `--consent-method` are required and have no default. An entry with no named
advocate and no record of how consent was given is refused, because consent is not optional and a
system that lets you skip it will be used to skip it.

Environment: `ANTHROPIC_API_KEY` is required for `add`; `ONRECORD_MODEL` overrides the default model.
Copy `.env.example` to `.env` to set them.

## Project layout

```
onrecord/
├── web/index.html      the map — one self-contained file, no build, no network
├── src/                the on-record CLI
│   ├── schema.ts       entry contract + canonicalization (key order is load-bearing)
│   ├── sign.ts         COSE/CBOR signing and human-readable provenance manifests
│   ├── c2pa.ts         official C2PA SDK signed-asset integration
│   ├── transform.ts    the disclosed Claude story-shaping step
│   ├── verify.ts       independent signature re-check
│   ├── seed.ts         composite sample set
│   └── cli.ts          command dispatch
├── data/               signed entries + provenance manifests
└── docs/protocol.md    signing format, manifest structure, threat model
```

`keys/` is generated on first run and is git-ignored. The private key never leaves the machine that
made it; committing one would let anyone forge entries under your identity.

To attach C2PA provenance to a real supported asset, run `npm run c2pa:dev-cert`, then:

```sh
on-record c2pa or_seed_01 --asset intake.png --output intake-signed.png
```

Development certificates are intentionally untrusted; production needs a C2PA CA-issued signing
certificate. The ledger never fabricates a PNG or other media file for a text record.

## Deployment

The map is deployed to GitHub Pages from `web/` by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main`. Enable it once
under **Settings ▸ Pages ▸ Source: GitHub Actions**; after that it is automatic. Forks get a working
demo without edits — the workflow derives no repository-specific paths.

Hosting it anywhere else is equally simple: the map is a single static file with no build step and
no backend, so any static host works. HTTPS is required, because WebCrypto is unavailable on
insecure origins.

### Verifying the "no network requests" claim

The claim is enforced, not just asserted. `web/index.html` carries a
`Content-Security-Policy` meta tag with `default-src 'none'`, so the browser blocks any fetch, font,
tile, remote image, or analytics beacon the page could ever attempt. WebCrypto is unaffected by CSP,
so signing and verification still work.

To confirm it yourself: open DevTools ▸ Network and reload. Only the HTML document should appear.

## Purpose

On Record exists to test a narrow question: can a person who does not have a reliable device, email,
address, username, or password leave a consented request and return to it later—while the community can
see whether a response was recorded without seeing the person’s identity?

The project is not trying to make poverty more visible as spectacle. It is trying to make a promise,
an offer, and a response legible to the people involved. The person’s agency, safety, and ability to
withdraw come before the map, the metrics, or the cryptography.

## Aspiration

The long-term aspiration is a governed, interoperable service layer that helps people living outdoors
move through document replacement, transportation, hygiene, mutual aid, and provider follow-up without
duplicating HMIS or coordinated-entry systems. It would provide:

- an accessible paper-and-kiosk recovery path;
- structured, moderated offers instead of public comment threads;
- provider workflows with individual identity, least privilege, and auditability;
- response visibility with context instead of punitive rankings;
- a public layer that contains only consented, de-identified information; and
- portable, independently verifiable provenance for records and real assets.

That aspiration is conditional. If a feature increases surveillance, stigma, exposure, or administrative
burden for people with the least power, the feature should be narrowed or removed.

## What this is—and is not

| This project is | This project is not |
|---|---|
| A prototype public communication layer | An HMIS or coordinated-entry replacement |
| A consented, advocate-mediated request ledger | A directory of people or encampment locations |
| A browser-verifiable integrity demonstration | Proof that a claim, provider, or outcome is true |
| A place for structured mutual-aid offers | A public comment section or live shelter inventory |
| A foundation for a governed pilot | A production system for real protected data |

Read [limitations](./docs/limitations.md) before using or adapting anything here.

## Audience guides

These guides are intentionally separate from the technical protocol:

- [For the public](./docs/for-the-public.md) — acknowledges frustration while reducing stigma and
  promoting empathy, boundaries, and practical help.
- [For people living outdoors](./docs/for-people-living-outdoors.md) — privacy, agency, recovery cards,
  provider accountability, and asking for help without surrendering dignity.
- [Living Outdoors with Respect](./docs/living-outdoors-with-respect.md) — practical guidance on safer
  camping choices, sanitation, waste, sharps, hygiene, noise, pets, and finding services.
- [Private Property Camping Permission](./docs/private-property-camping-permission.md) — a printable
  agreement a person can take to a business or property representative. A [print-ready HTML form](./web/forms/camping-permission.html)
  is also available.
- [Respectful Neighbor / Considerate Camper placard](./docs/respectful-neighbor-tent-placard.md) — a
  high-contrast, printable good-neighbor commitment for a tent or outdoor living space; see the
  [print-ready placard](./web/forms/respectful-neighbor-tent-placard.html).
- [San Diego emergency resource directory](./docs/san-diego-emergency-resource-directory.md) — a
  verify-before-travel pocket guide anchored to 2-1-1 and official provider pages.
- [Emergency health card](./docs/emergency-health-card.md) — a private paper-only card; never upload it
  to the public system. A [print-ready card](./web/forms/emergency-health-card.html) is available.
- [Mutual-aid peer mediation agreement](./docs/mutual-aid-peer-mediation-agreement.md) — voluntary
  shared ground rules and conflict-resolution framework.
- [Document recovery checklist](./docs/document-recovery-checklist.md) — birth certificate, California
  ID, Social Security card, DD-214, fee-waiver, and follow-up tracking.
- [Know Your Rights](./docs/know-your-rights.md) — law-enforcement encounters, encampment sweeps,
  citations, property, discrimination, and documenting a possible violation. It is educational, not
  legal advice, and must be reviewed as local law changes.

The `wiki/` directory contains wiki-ready summaries. The `docs/` versions are canonical and reviewable
in pull requests.

## Roadmap to a real deployment

1. **Prototype:** synthetic data, static viewer, signed fixtures, and explicit limitations.
2. **Governed pilot:** lived-experience advisory group, one narrow use case, paper/kiosk usability,
   privacy review, moderation policy, and no real HMIS imports.
3. **Private service layer:** encrypted API/database, individual workforce identity, MFA, RBAC/ABAC,
   moderation queues, durable append-only audits, key custody, incident response, and accessibility
   testing.
4. **Controlled interoperability:** data-sharing agreements, current HUD standards mapping, separate
   VAWA/FVPSA-sensitive workflows, and authorized freshness/provenance for any operational feed.
5. **Measured expansion:** mutual aid and verified responses only after safety review, with public
   aggregate outcomes and a stop rule for harmful features.

The detailed gate criteria are in [docs/roadmap.md](./docs/roadmap.md), [docs/hmis-alignment.md](./docs/hmis-alignment.md),
and [docs/security-and-provider-policy.md](./docs/security-and-provider-policy.md).

## Discussions and the wiki

The project is intended to be shaped by people with lived experience, advocates, providers, privacy
professionals, accessibility practitioners, and maintainers. Discussion seeds are in
[docs/discussions](./docs/discussions/README.md). They cover the first pilot, recovery cards, public/
private boundaries, moderation, provider participation, field accessibility, and HMIS interoperability.

The [wiki mirror](./wiki/Home.md) organizes architecture, limitations, roadmap, community guides, and
rights information for readers who prefer a handbook. Before publishing a page to a live wiki or
starting a discussion, remove any real client story, recovery material, precise location, or protected
provider information from the draft.

## Contributing responsibly

Please open an issue or discussion before adding a new data field, public metric, provider integration,
identity workflow, or moderation policy. Explain:

1. who benefits and who could be harmed;
2. what is collected, where it is stored, who can see it, and when it is deleted;
3. how a person can decline, correct, withdraw, or appeal;
4. what happens when the system is wrong, unavailable, compromised, or abused; and
5. how the change will be tested with people using low-cost devices and assistive technology.

Never commit real client data, names, dates of birth, ZIP codes, recovery cards, provider credentials,
private keys, or screenshots containing protected information.

## Ethics, and the data in this repo

This project is about people who cannot correct the record about themselves, which sets the rules:

- **The sample entries are composites.** They are marked as such in `data/entries.json`. They do not
  describe real individuals and must not be cited as though they do.
- **Institutional figures are placeholders.** Any dollar amount shown against an agency or budget is
  an illustrative round number, attributed to no real entity, present only to demonstrate the
  promise-versus-proof mechanic.
- **Consent is structural, not procedural.** The schema has nowhere to put an entry that lacks a
  named advocate and a recorded consent method, so there is no path that quietly omits it.
- **The raw text always ships with the shaped text.** A reader who distrusts the model can always
  read around it.

If you deploy this with real people's accounts, those obligations become yours, and they are heavier
than the code.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security issues: [SECURITY.md](./SECURITY.md) — please do
not open a public issue for a vulnerability.

## License

[MIT](./LICENSE) © David Condrey
