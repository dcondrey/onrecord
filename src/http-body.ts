/**
 * Shared request-body reader for the local HTTP intake surfaces (`/api/add` in
 * cli.ts, the SMS gateway in gateway/sms.ts). Caps body size before it's ever
 * buffered in full, so a slow-loris style oversized POST can't exhaust memory.
 */

export const MAX_BODY_BYTES = 256 * 1024;

export async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
