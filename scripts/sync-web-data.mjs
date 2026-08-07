#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const webPath = 'web/index.html';
const entries = JSON.parse(await readFile('data/entries.json', 'utf8'));
let html = await readFile(webPath, 'utf8');
const pattern = /const V2_ENTRIES = \/\* ONRECORD_V2_DATA_START \*\/.*?\/\* ONRECORD_V2_DATA_END \*\//s;
if (!pattern.test(html)) throw new Error('web data markers not found');
html = html.replace(pattern, `const V2_ENTRIES = /* ONRECORD_V2_DATA_START */ ${JSON.stringify(entries)} /* ONRECORD_V2_DATA_END */`);
await writeFile(webPath, html);
console.log(`embedded ${entries.length} protocol-v2 entries in ${webPath}`);
