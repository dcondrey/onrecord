# Contributing to On Record

Thanks for your interest in improving On Record. This document describes how to report issues, set
up a development environment, and submit changes.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you are
expected to uphold it.

## The rules that shape everything

On Record publishes accounts from people who are not in the room and cannot correct the record about
themselves. Three constraints follow, and a change that breaks any of them will not be accepted:

1. **Zones, never coordinates.** No latitude, longitude, street address, GPS field, or shelter name
   enters the schema. `assertNoPreciseLocation()` enforces this at any depth — do not add an
   exception for it.
2. **No entry without recorded consent.** `consent.advocateId`, `consent.method`, and
   `consent.timestampISO` are required with no default and no placeholder. Do not add a
   `--skip-consent`, a default advocate, or a "draft" mode that writes without them.
3. **The raw text always ships with the shaped text.** A reader must always be able to read around
   the model. Do not add a publish path that emits `shaped` without `raw`.

And one that keeps the cryptography honest: **the seal only covers what is checkable.** An
organization-directed claim with no source stays in `unsignedNotes`. Do not move it into the signed
assertions.

## Development setup

Prerequisites: **Node ≥ 20**. An `ANTHROPIC_API_KEY` is needed only for `on-record add`; everything
else runs without one.

```sh
npm install
npm run build       # tsc
npm run typecheck   # tsc --noEmit
npm run seed        # write the composite sample set to data/
npm run verify      # independently re-check every signature
```

For the map, no toolchain is involved at all:

```sh
python3 -m http.server 8080 --directory web
```

## Changing the schema

`src/schema.ts` key order is load-bearing — `canonicalize()` serializes in exactly that order, and
the SHA-256 of that serialization is what gets signed. **Reordering, renaming, or inserting a field
invalidates every existing signature.**

If a change to the entry shape is genuinely necessary:

- Bump `MANIFEST_VERSION` in `src/sign.ts`.
- Re-run `npm run seed -- --force` so `data/` matches the new format.
- Confirm `npm run verify` passes on the regenerated set.
- Update the browser verifier in `web/index.html` in the same PR — the two verifiers must never
  disagree, and CI cannot catch a divergence for you.
- Say so explicitly in the PR description.

## Conventions

- **TypeScript, ESM only.** Import local files with explicit `.js` extensions. `strict` +
  `noUncheckedIndexedAccess` + `verbatimModuleSyntax` are on; keep them on.
- **The map is one file.** `web/index.html` is intentionally self-contained: no build step, no
  bundler, no dependencies, no network requests. Do not introduce a toolchain for it, and do not add
  anything the `default-src 'none'` CSP would have to be loosened to permit.
- **Never stub a missing symbol.** If something appears undefined, find out why — a missing import,
  a build cache, an access level. Do not add an empty function or a placeholder value to make a file
  compile.

## Commits

`<type>: <description>` — single line, imperative, no em-dashes.
`type ∈ fix | feat | refactor | test | docs | perf | security | chore`. One logical unit per commit.

## Pull requests

- Branch off `main`; keep PRs focused.
- Fill in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md), including the ethics checks.
- CI (typecheck, build, verify) must pass.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md) — **do not** open a public issue.

## A note on sample data

Everything in `data/` is a composite. If you add or regenerate seed entries, they must stay
composites, stay marked with the `org.onrecord.composite` assertion, and describe no real
identifiable person. Do not commit a real person's account to this repository, with or without their
consent — this is a demonstration repo, not a deployment.
