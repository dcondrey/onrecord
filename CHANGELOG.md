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

### Changed
- The map moved from the repository root to `web/index.html`.
- `on-record serve` now serves the viewer from `web/`.

### Fixed
- `on-record serve` pointed at `/public/index.html`, a directory that has never existed in this
  repository, so the default route always 404'd.

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
