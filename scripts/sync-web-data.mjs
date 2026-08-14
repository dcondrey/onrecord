#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const webPath = 'web/index.html';
const entries = JSON.parse(await readFile('data/entries.json', 'utf8'));
let html = await readFile(webPath, 'utf8');
const pattern = /const V2_ENTRIES = \/\* ONRECORD_V2_DATA_START \*\/.*?\/\* ONRECORD_V2_DATA_END \*\//s;
if (!pattern.test(html)) throw new Error('web data markers not found');
// A function replacer, not a string one: a string second argument to replace() interprets
// $&, $`, $', $$ as special patterns, so any entry text containing e.g. a literal "$&"
// would corrupt the embedded JSON. Escaping "/" additionally neutralizes "</script" in
// any story text, which would otherwise close the script element early and break the page.
const json = JSON.stringify(entries).replace(/\//g, '\\/');
html = html.replace(pattern, () => `const V2_ENTRIES = /* ONRECORD_V2_DATA_START */ ${json} /* ONRECORD_V2_DATA_END */`);

// data/did.json (written by seed.ts/add.ts from the org's current ONRECORD_ISSUER_DID)
// is the org's live trust document. Publish a copy under web/ so it resolves at the
// real did:web HTTPS path (GitHub Pages serves web/ as the site root), and embed it
// inline too — the CSP is default-src 'none', so the offline verifier can never fetch()
// it at runtime and must carry its own copy, the same way it carries V2_ENTRIES.
const didDoc = JSON.parse(await readFile('data/did.json', 'utf8'));
await writeFile('web/did.json', JSON.stringify(didDoc, null, 2) + '\n');
const didJson = JSON.stringify(didDoc).replace(/\//g, '\\/');
const trustPattern = /const TRUST_DOCUMENT = \/\* ONRECORD_TRUST_DOC_START \*\/.*?\/\* ONRECORD_TRUST_DOC_END \*\//s;
if (!trustPattern.test(html)) throw new Error('trust document marker not found');
html = html.replace(trustPattern, () => `const TRUST_DOCUMENT = /* ONRECORD_TRUST_DOC_START */ ${didJson} /* ONRECORD_TRUST_DOC_END */`);

await writeFile(webPath, html);
console.log(`embedded ${entries.length} protocol-v2 entries and the trust document (${didDoc.id}) in ${webPath}`);
