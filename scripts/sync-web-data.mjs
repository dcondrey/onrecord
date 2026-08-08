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
await writeFile(webPath, html);
console.log(`embedded ${entries.length} protocol-v2 entries in ${webPath}`);
