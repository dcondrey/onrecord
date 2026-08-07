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

export async function buildC2paArchive(entry: Entry, options: C2paOptions): Promise<Buffer> {
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

  const unsignedArchive: { buffer: Buffer | null } = { buffer: null };
  await builder.toArchive(unsignedArchive);
  if (!unsignedArchive.buffer) throw new Error('C2PA SDK did not produce an archive');

  const signer = LocalSigner.newSigner(
    await readFile(options.certificatePath),
    await readFile(options.privateKeyPath),
    'es256',
  );
  const signed = builder.sign(
    signer,
    { buffer: unsignedArchive.buffer, mimeType: 'application/c2pa' },
    { buffer: null },
  );
  if (!signed || signed.length === 0) throw new Error('C2PA SDK returned an empty signed archive');
  return signed;
}
