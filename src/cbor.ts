/**
 * Small deterministic CBOR codec for the On Record wire format.
 *
 * It intentionally supports the JSON data model used by entries plus byte
 * strings. Map keys are encoded in canonical CBOR order (RFC 8949 §4.2.3).
 * Keeping this implementation dependency-free lets the browser verifier use
 * the same bytes as the CLI.
 */

export class CborError extends Error {
  override readonly name = 'CborError';
}

function fail(message: string): never {
  throw new CborError(message);
}

function uint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) fail(`invalid CBOR unsigned integer: ${value}`);
  if (value < 24) return Uint8Array.of(value);
  if (value < 0x100) return Uint8Array.of(24, value);
  if (value < 0x10000) return Uint8Array.of(25, value >> 8, value & 0xff);
  if (value < 0x100000000) return Uint8Array.of(26, value >>> 24, value >>> 16 & 0xff, value >>> 8 & 0xff, value & 0xff);
  const out = new Uint8Array(9); out[0] = 27;
  new DataView(out.buffer).setBigUint64(1, BigInt(value));
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function head(major: number, length: number): Uint8Array {
  const n = uint(length); n[0] = n[0]! | major << 5; return n;
}

function encodeValue(value: unknown): Uint8Array {
  if (value === null) return Uint8Array.of(0xf6);
  if (value === false) return Uint8Array.of(0xf4);
  if (value === true) return Uint8Array.of(0xf5);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value); return concat(head(3, bytes.length), bytes);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NaN and Infinity are not supported in canonical CBOR');
    if (Number.isSafeInteger(value)) {
      if (value >= 0) return uint(value);
      return head(1, -1 - value);
    }
    const out = new Uint8Array(9); out[0] = 0xfb; new DataView(out.buffer).setFloat64(1, value); return out;
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (value instanceof ArrayBuffer) return encodeValue(new Uint8Array(value));
  if (Array.isArray(value)) return concat(head(4, value.length), ...value.map(encodeValue));
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([key, val]) => { const encodedKey = encodeValue(key); return { encodedKey, val }; });
    entries.sort((a, b) => a.encodedKey.length - b.encodedKey.length || compareBytes(a.encodedKey, b.encodedKey));
    return concat(head(5, entries.length), ...entries.flatMap(({ encodedKey, val }) => [encodedKey, encodeValue(val)]));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      const encodedKey = encodeValue(key); return { encodedKey, val };
    });
    entries.sort((a, b) => a.encodedKey.length - b.encodedKey.length || compareBytes(a.encodedKey, b.encodedKey));
    return concat(head(5, entries.length), ...entries.flatMap(({ encodedKey, val }) => [encodedKey, encodeValue(val)]));
  }
  fail(`unsupported CBOR value: ${typeof value}`);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

export function encodeCanonical(value: unknown): Uint8Array { return encodeValue(value); }

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  private take(n: number): Uint8Array { if (this.offset + n > this.bytes.length) fail('truncated CBOR'); const out = this.bytes.slice(this.offset, this.offset + n); this.offset += n; return out; }
  private length(additional: number): number {
    if (additional < 24) return additional;
    const n = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : additional === 27 ? 8 : 0;
    if (!n) fail('indefinite-length CBOR is not accepted');
    const raw = this.take(n); const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const value = n === 1 ? view.getUint8(0) : n === 2 ? view.getUint16(0) : n === 4 ? view.getUint32(0) : Number(view.getBigUint64(0));
    if (!Number.isSafeInteger(value)) fail('CBOR integer exceeds safe range'); return value;
  }
  value(): unknown {
    const initial = this.take(1)[0]!; const major = initial >> 5; const additional = initial & 31;
    if (major === 0) return this.length(additional);
    if (major === 1) return -1 - this.length(additional);
    if (major === 2 || major === 3) { const raw = this.take(this.length(additional)); return major === 2 ? raw : new TextDecoder().decode(raw); }
    if (major === 4) { const n = this.length(additional); return Array.from({ length: n }, () => this.value()); }
    if (major === 5) { const n = this.length(additional); const pairs: [unknown, unknown][] = []; let strings = true; for (let i = 0; i < n; i++) { const key = this.value(); if (typeof key !== 'string') strings = false; pairs.push([key, this.value()]); } if (strings) { const out: Record<string, unknown> = {}; for (const [key, value] of pairs) out[key as string] = value; return out; } return new Map(pairs); }
    if (major === 6) { this.length(additional); return this.value(); }
    if (major === 7 && additional === 20) return false;
    if (major === 7 && additional === 21) return true;
    if (major === 7 && additional === 22) return null;
    if (major === 7 && additional === 27) return new DataView(this.take(8).buffer).getFloat64(0);
    fail(`unsupported CBOR major type ${major}`);
  }
  done(): boolean { return this.offset === this.bytes.length; }
}

export function decode(bytes: Uint8Array): unknown { const reader = new Reader(bytes); const value = reader.value(); if (!reader.done()) fail('trailing CBOR bytes'); return value; }
