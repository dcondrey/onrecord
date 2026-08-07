/**
 * C2PA archive generation through the maintained Content Authenticity SDK.
 *
 * Records are published as JSON/CBOR, while this module emits a signed
 * application/c2pa sidecar. The sidecar carries the exact CBOR payload as an
 * `org.onrecord.entry` assertion, so a C2PA reader can inspect the record and
 * the record verifier can independently bind it back to the JSON entry.
 */

import { Builder, LocalSigner } from '@contentauth/c2pa-node';
import { readFile } from 'node:fs/promises';
import type { Entry } from './schema.js';
import type { AiTransformDisclosure, OrgClaim } from './sign.js';

export interface C2paOptions {
  certificatePath: string;
  privateKeyPath: string;
  aiTransform: AiTransformDisclosure;
  orgClaim?: OrgClaim;
  composite?: boolean;
}

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length); return out;
}

function recordAsset(entry: Entry): Buffer {
  const text = Buffer.from(`onrecord\0${entry.id}:${entry.provenance.contentHash}`, 'utf8');
  return Buffer.concat([ONE_PIXEL_PNG.subarray(0, ONE_PIXEL_PNG.length - 12), pngChunk('tEXt', text), ONE_PIXEL_PNG.subarray(ONE_PIXEL_PNG.length - 12)]);
}

export async function buildC2paAsset(entry: Entry, options: C2paOptions): Promise<Buffer> {
  const builder = Builder.withJson({
    claim_generator_info: [{ name: 'on-record', version: '2.0' }],
  });
  builder.setIntent({
    create: options.aiTransform.applied
      ? 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced'
      : 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
  });
  builder.addAssertion('c2pa.actions', {
    actions: [{
      action: options.aiTransform.applied ? 'c2pa.edited' : 'c2pa.created',
      softwareAgent: options.aiTransform.applied ? options.aiTransform.model : 'on-record/2.0',
      digitalSourceType: options.aiTransform.applied
        ? 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced'
        : 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
    }],
  });
  builder.addAssertion('org.onrecord.entry', {
    id: entry.id,
    issuer: entry.provenance.issuer,
    verificationMethod: entry.provenance.verificationMethod,
    cborSha256: entry.provenance.contentHash,
    cborPayload: entry.provenance.cborPayload,
  });
  builder.addAssertion('org.onrecord.consent', entry.consent);
  builder.addAssertion('org.onrecord.location-precision', {
    granularity: 'zone', zone: entry.zone, coordinates: false,
  });
  builder.addAssertion('org.onrecord.ai-transform', options.aiTransform);
  if (options.composite) builder.addAssertion('org.onrecord.composite', { composite: true });
  if (options.orgClaim?.source) builder.addAssertion('org.onrecord.org-claim', options.orgClaim);

  const signer = LocalSigner.newSigner(
    await readFile(options.certificatePath),
    await readFile(options.privateKeyPath),
    'es256',
  );
  const destination: { buffer: Buffer | null } = { buffer: null };
  builder.sign(
    signer,
    { buffer: recordAsset(entry), mimeType: 'image/png' },
    destination,
  );
  if (!destination.buffer || destination.buffer.length === 0) throw new Error('C2PA SDK returned an empty signed asset');
  return destination.buffer;
}
