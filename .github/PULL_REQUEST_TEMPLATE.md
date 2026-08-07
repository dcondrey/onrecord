## Description

<!-- Brief description of the changes -->

## Related Issues

<!-- Link to related issues: Fixes #123, Relates to #456 -->

## Type of Change

- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to change)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] Security fix

## Checklist

### Code Quality
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] `npm run verify` passes on `data/entries.json`
- [ ] Self-review completed; no debug artifacts, no stubbed-out symbols

### Signing contract
- [ ] No change to `src/schema.ts` key order — **or** signatures were regenerated, `MANIFEST_VERSION` bumped, and the browser verifier in `web/index.html` updated in this PR
- [ ] The browser verifier and `src/verify.ts` still agree on every entry in `data/`

### Ethics
- [ ] No coordinate, address, GPS, or shelter-name field added to the schema
- [ ] The consent gate is still unconditional — no default advocate, no skip flag
- [ ] `story.raw` still ships with `story.shaped` on every publish path
- [ ] Unsourced organization-directed claims still stay out of the signed assertions
- [ ] Any sample data added is a composite, marked as such, and describes no real person

### The map
- [ ] `web/index.html` still makes zero network requests (DevTools ▸ Network shows only the document)
- [ ] No loosening of the `default-src 'none'` CSP

### Docs
- [ ] README / `docs/protocol.md` / CHANGELOG updated if behavior or format changed
