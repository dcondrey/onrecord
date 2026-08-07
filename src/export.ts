import { zipSync, strToU8 } from 'fflate';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { signCoseSign1 } from './cose.js';
import { fromBase64, toHex } from './encoding.js';
import { didKeyFromPublicJwk, verificationMethodForDid } from './did.js';
import { loadOrCreateKeyPair } from './sign.js';
import type { Entry } from './schema.js';

const subtle = webcrypto.subtle;

export interface ExportResult { zipPath: string; signaturePath: string; contentHash: string; }

/** Export a portable, offline-verifiable record bundle plus a detached COSE seal. */
export async function exportRecordBundle(entry: Entry, outputPath: string, baseDir = process.cwd()): Promise<ExportResult> {
  if (entry.provenance.protocolVersion !== '2.0' || !entry.provenance.cborPayload) throw new Error('record must use protocol v2 before it can be exported');
  const manifestPath = join(baseDir, 'data', 'manifests', `${entry.id}.json`);
  const didPath = join(baseDir, 'data', 'did.json');
  const files: Record<string, Uint8Array> = {
    'entry.json': strToU8(JSON.stringify(entry, null, 2) + '\n'),
    'entry.cbor': fromBase64(entry.provenance.cborPayload ?? ''),
    'manifest.json': strToU8(await readFile(manifestPath, 'utf8')),
    'did.json': strToU8(await readFile(didPath, 'utf8')),
    'VERIFY.txt': strToU8([
      'On Record export bundle',
      '',
      'The entry is independently verifiable offline with:',
      '  on-record verify entry.json --did-doc did.json',
      '',
      'bundle.cose.json is a detached COSE_Sign1 seal over the exact ZIP bytes.',
      'The ZIP seal proves bundle integrity; entry.cbor and entry.json carry the record proof.',
      '',
    ].join('\n')),
  };
  const zip = zipSync(files, { level: 6 });
  const keys = await loadOrCreateKeyPair(baseDir);
  const cose = await signCoseSign1(zip, keys.privateJwk, 'key-1');
  const digest = await subtle.digest('SHA-256', zip);
  const issuer = process.env['ONRECORD_ISSUER_DID']?.trim() || didKeyFromPublicJwk(keys.publicJwk);
  const signature = {
    format: 'org.onrecord.export/1',
    asset: { mediaType: 'application/zip', sha256: toHex(digest), bytes: zip.length },
    issuer, verificationMethod: verificationMethodForDid(issuer),
    payload: cose.payload, coseSign1: cose.sign1,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, zip);
  const signaturePath = `${outputPath}.cose.json`;
  await writeFile(signaturePath, JSON.stringify(signature, null, 2) + '\n');
  return { zipPath: outputPath, signaturePath, contentHash: toHex(digest) };
}
