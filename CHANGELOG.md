# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Note that `src/schema.ts` key order is part of the signing contract: any change to it is **breaking**
and invalidates every previously issued signature.

## [Unreleased]

### Added
- GitHub Pages deployment of the map from `web/`, published by `.github/workflows/pages.yml`.
- `Content-Security-Policy` meta tag (`default-src 'none'`) in `web/index.html`, so the
  zero-network-requests claim is enforced by the browser on any host — Pages cannot set response
  headers, so the guarantee now travels with the file.
- CI: typecheck, build, and re-verification of every committed signature on each push; plus an
  offline-guard job that fails the build if the map gains an external reference, a network API, or a
  loosened CSP.
- `docs/protocol.md` — canonicalization, signing format, manifest structure, threat model, and an
  explicit account of what the scheme does *not* prove.
- Repository scaffolding: `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `.editorconfig`, issue and pull-request templates, `CODEOWNERS`, Dependabot, and OpenSSF Scorecard.
- `npm run typecheck`.

- A local intake form for advocates who aren't CLI-comfortable: `on-record serve` now also serves
  `GET /add` (renders the form) and `POST /api/add` (same-origin only, serialized against concurrent
  submissions), sharing `addEntry()` (`src/add.ts`) with `on-record add` so both entry points validate
  and publish identically. Binds to `127.0.0.1` by default; `--host` to override.
- `on-record withdraw <entry-id>`: removes an entry from the public record for good (deletes it from
  `data/entries.json` and its manifest, no re-signed tombstone) and logs the fact internally — id, zone,
  category, timestamp, never the story text — to a gitignored `data/withdrawn.json`, never served or
  embedded into the map.
- 5 more composite seed entries (`or_seed_04`–`08`), so the sample set now covers all 8 zones and all 7
  ask categories instead of 3 and 3 — every filter and dashboard bucket has something to show.
- `test/web-data-sync.test.js`, `test/verify-crash.test.js`, `test/export.test.js`, `test/did.test.js`,
  `test/add.test.js`, `test/intake-server.test.js`, `test/dob.test.js`,
  `test/manifest-version-drift.test.js` — coverage for previously-untested paths (the add pipeline, the
  HTTP intake handler, did.ts's trust-pinning helpers, the export/verify round trip, a wider DOB-parsing
  format matrix, and drift between the map's embedded data / the signing schema's field set and the
  version it was last signed under).
- A minimal Biome lint config (`biome.json`, `npm run lint`, wired into CI) scoped to `src/`, `test/`,
  and `scripts/` — real correctness rules only (`==`, unreachable code, duplicate object keys), not
  style; `web/index.html` is exempt (its dense inline-script style is deliberate) and tsconfig's
  `noUnusedLocals`/`noUnusedParameters` already cover unused-variable detection.

### Changed
- The map moved from the repository root to `web/index.html`.
- `on-record serve` now serves the viewer from `web/`.
- `addEntry()` (`src/add.ts`) no longer fails an entry outright when Claude declines to shape a story —
  it falls back to publishing the raw text unchanged (the transform prompt's own stated ideal for a
  too-sparse note), and discloses that honestly in the manifest (`aiTransform.applied: false`) rather
  than silently claiming a transform that didn't happen. The accounts most likely to trigger a safety
  refusal (assault, being turned away) are exactly the ones the system prompt says must never be
  softened, so failing them outright would have made the most urgent requests the least publishable.
- `addEntry()` re-reads `data/entries.json` immediately before writing, not once at the top of the
  function — the Claude call and signing in between can take several seconds, long enough for a second
  writer (another CLI invocation, or a concurrent request outside one `serve` process's own queue) to
  have appended in the meantime; the earlier version could silently lose that writer's entry.

### Fixed
- `on-record serve` pointed at `/public/index.html`, a directory that has never existed in this
  repository, so the default route always 404'd.
- The browser's protocol-v2 (COSE_Sign1) verifier in `web/index.html` — a hand-ported reimplementation
  of `src/sign.ts`'s verifier, per the "the two verifiers must never disagree" rule — had two bugs
  that silently broke it for every real committed entry: `cborRead()` called `ENC.decode()` on a
  `TextEncoder` (no such method; needed a `TextDecoder`), and `seal()` base64-decoded an
  already-decoded signature a second time. Both were swallowed by boot's catch block, which showed
  the misleading "WebCrypto unavailable here" instead of the real error, so the live GitHub Pages
  demo showed all 3 seed records as failing signature verification. Added `test/verify-cose.test.js`,
  which runs the real extracted browser verifier against `data/entries.json` (accept) and a tampered
  copy (reject), so this class of drift fails CI instead of shipping silently.
- The "Promise vs proof" birth-certificate line showed a `$29` figure with a `[source]` label that
  wasn't an actual link, unlike every other figure in that section. Replaced with CDPH's current
  statewide fee ($31, raised by AB 64 effective 2026-01-01) and the fact that actually matters here:
  it's waived to $0 for anyone who can show homeless status under the federal McKinney-Vento
  definition (Health & Safety Code §103577), the same fee-waiver shape already shown for the DMV
  state ID line — with a real link to CDPH's program page.
- `verifyFile()` (`src/verify.ts`) crashed instead of reporting a clean FAIL on a corrupted or malformed
  protocol-v2 entry (e.g. a corrupted `pubKey`) — `verifyCoseEntry()` had no try/catch, unlike the legacy
  v1 path, so one bad entry could abort `on-record verify`'s (and CI's `npm run verify` gate's) entire
  run instead of just failing that one entry. Added `test/verify-crash.test.js`.
- `on-record verify` couldn't actually run the command its own `on-record export` bundle's `VERIFY.txt`
  tells a reader to run: `entry.json` inside an export bundle is a single record, not an array, and
  `verifyFile()` required a JSON array. Now accepts a single entry object too. Added
  `test/export.test.js`, which round-trips a real committed entry through export and runs the literal
  documented command against the result.
- `normalizeDob()` (`src/recovery.ts`) misparsed hyphenated spelled-out ordinal days — "March
  twenty-first, 1984" resolved to the 20th, not the 21st, because the tokenizer splits on hyphens the
  same as spaces, so "twenty" and "first" arrived as two independent numbers (20 and 1) instead of
  combining into 21, and 20 (itself a valid day) won the day-number search first. This parser gates
  access to a real person's own recovery card, so a misparse either locks the right person out or
  admits a PIN-guesser. Added `test/dob.test.js` with a wider format matrix.
- `package.json`'s `allowScripts` field is npm's own native install-script review mechanism (`npm
  approve-scripts`/`npm deny-scripts`, advisory as of npm 11), not inert or LavaMoat-specific as
  initially assumed and briefly removed mid-session — restored once verified against npm's actual
  current behavior.

### Removed
- `guide-me.snippet.html` — the walkthrough has been merged into `web/index.html`; the standalone
  snippet was a stale duplicate.
- `DEPLOY.md` — superseded by the README and `.github/workflows/pages.yml`. Its step 1 and step 2
  (hand-copying the artifact and pasting in the guide snippet) described work already done.
- `_headers` — Cloudflare Pages-specific and inert on GitHub Pages. The CSP it carried is now a meta
  tag in the document itself.

## [1.0.0] — 2026-08-06

### Added
- Initial release: the `on-record` CLI (`add`, `verify`, `seed`, `serve`, `keys`), the entry schema
  with its consent gate and precise-location refusal, ECDSA-P256 signing over canonical entry
  bytes, C2PA-style provenance manifests, the disclosed Claude story-shaping transform, and the
  self-contained browser map.

[Unreleased]: https://github.com/writerslogic/onrecord/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/writerslogic/onrecord/releases/tag/v1.0.0
