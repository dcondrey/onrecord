/** C2PA signing for a real supported asset, using the official SDK. */

import { Builder, LocalSigner } from '@contentauth/c2pa-node';
import { readFile } from 'node:fs/promises';
import type { Entry } from './schema.js';
import type { AiTransformDisclosure, OrgClaim } from './sign.js';

export interface C2paAssetOptions {
  assetPath: string;
  outputPath: string;
  certificatePath: string;
  privateKeyPath: string;
  aiTransform?: AiTransformDisclosure;
  orgClaim?: OrgClaim;
  composite?: boolean;
}

/**
 * Adds a C2PA manifest to an actual asset (PNG, JPEG, PDF, etc.). JSON ledger
 * records are not disguised as media; callers must provide the asset whose
 * provenance is being asserted. The entry is carried as a custom assertion
 * and remains independently verifiable through its COSE/CBOR envelope.
 */
export async function signC2paAsset(entry: Entry, options: C2paAssetOptions): Promise<void> {
  const builder = Builder.withJson({ claim_generator_info: [{ name: 'on-record', version: '2.0' }] });
  const ai = options.aiTransform;
  builder.setIntent({
    create: ai?.applied
      ? 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced'
      : 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture',
  });
  builder.addAssertion('c2pa.actions', {
    actions: [{
      action: ai?.applied ? 'c2pa.edited' : 'c2pa.created',
      softwareAgent: ai?.applied ? ai.model : 'on-record/2.0',
      digitalSourceType: ai?.applied
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
  builder.addAssertion('org.onrecord.location-precision', { granularity: 'zone', zone: entry.zone, coordinates: false });
  if (ai) builder.addAssertion('org.onrecord.ai-transform', ai);
  if (options.composite) builder.addAssertion('org.onrecord.composite', { composite: true });
  if (options.orgClaim?.source) builder.addAssertion('org.onrecord.org-claim', options.orgClaim);

  const signer = LocalSigner.newSigner(
    await readFile(options.certificatePath),
    await readFile(options.privateKeyPath),
    'es256',
  );
  builder.sign(signer, { path: options.assetPath }, { path: options.outputPath });
}
