import { webcrypto } from 'node:crypto';
import { toHex } from './encoding.js';

const subtle = webcrypto.subtle;
const SALT = new TextEncoder().encode('onrecord/claim/v1');

function normalizePhrase(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, ' '); }

export interface RecoveryIdentity {
  first3: string;
  last3: string;
  dateOfBirth: string;
  postalCode: string;
}

function letters(value: string): string { return value.normalize('NFKD').replace(/[^a-z]/gi, '').toLowerCase(); }
function normalizeDob(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(digits)) {
    const yyyyFirst = Number(digits.slice(0, 4));
    return yyyyFirst > 1900 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : `${digits.slice(4)}-${digits.slice(0, 2)}-${digits.slice(2, 4)}`;
  }
  throw new Error('date of birth must be YYYY-MM-DD, YYYYMMDD, or MMDDYYYY');
}

/** A familiar intake identifier, never stored—only a keyed verifier tag is. */
export async function recoveryIdentityTag(identity: RecoveryIdentity, pin: string, recordId: string): Promise<string> {
  const first = letters(identity.first3);
  const last = letters(identity.last3);
  if (first.length !== 3 || last.length !== 3) throw new Error('first3 and last3 must each contain exactly three letters');
  const zip = identity.postalCode.replace(/\D/g, '');
  if (!/^\d{5}$/.test(zip)) throw new Error('postal code must contain exactly five digits');
  if (!/^\d{4}$/.test(pin)) throw new Error('recovery PIN must contain exactly four digits');
  const material = `${first}:${last}:${normalizeDob(identity.dateOfBirth)}:${zip}:${pin}`;
  const base = await subtle.importKey('raw', new TextEncoder().encode(material), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt: SALT, iterations: 120000, hash: 'SHA-256' }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  return toHex(await subtle.sign('HMAC', key, new TextEncoder().encode(`author:${recordId}`)));
}

/** Derives only a verifier tag; the phrase/PIN never enters the record. */
export async function recoveryTag(phrase: string, pin: string, recordId: string): Promise<string> {
  if (normalizePhrase(phrase).split(' ').length < 4) throw new Error('recovery phrase must contain at least four words');
  if (!/^\d{4}$/.test(pin)) throw new Error('recovery PIN must contain exactly four digits');
  const material = new TextEncoder().encode(`${normalizePhrase(phrase)}:${pin}`);
  const base = await subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt: SALT, iterations: 60000, hash: 'SHA-256' }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  return toHex(await subtle.sign('HMAC', key, new TextEncoder().encode(`author:${recordId}`)));
}
