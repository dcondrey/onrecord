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
const MONTHS: Record<string, number> = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };
const NUMBER_WORDS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, twentyfirst: 21, twentysecond: 22, twentythird: 23, twentyfourth: 24, twentyfifth: 25, twentysixth: 26, twentyseventh: 27, twentyeighth: 28, twentyninth: 29, thirtieth: 30, thirtyfirst: 31 };
function numberWords(value: string): number | undefined {
  const words = value.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((w) => w && w !== 'the' && w !== 'of');
  if (!words.length) return undefined;
  if (words.length === 1 && ORDINALS[words[0]!.replace(/\s/g, '')] !== undefined) return ORDINALS[words[0]!.replace(/\s/g, '')];
  if (words.every((w) => NUMBER_WORDS[w] !== undefined)) return words.reduce((n, w) => n + NUMBER_WORDS[w]!, 0);
  let total = 0; let current = 0;
  for (const word of words) {
    if (NUMBER_WORDS[word] !== undefined) current += NUMBER_WORDS[word]!;
    else if (word === 'hundred') current *= 100;
    else if (word === 'thousand') { total += current * 1000; current = 0; }
    else return undefined;
  }
  return total + current || undefined;
}
function yearValue(raw: string): number | undefined {
  const digits = raw.replace(/[^0-9]/g, '');
  if (/^\d{4}$/.test(digits)) return Number(digits);
  if (/^\d{2}$/.test(digits)) { const n = Number(digits); return n <= 29 ? 2000 + n : 1900 + n; }
  const words = numberWords(raw);
  if (words === undefined) return undefined;
  if (words >= 1000) return words;
  const parts = raw.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && NUMBER_WORDS[parts[0]!] !== undefined && NUMBER_WORDS[parts[1]!] !== undefined) return NUMBER_WORDS[parts[0]!]! * 100 + numberWords(parts.slice(1).join(' '))!;
  return words < 100 ? (words <= 29 ? 2000 + words : 1900 + words) : words;
}
function yearFromTokens(tokens: string[]): number | undefined {
  for (let length = Math.min(4, tokens.length); length >= 1; length--) {
    const candidate = tokens.slice(tokens.length - length).join(' ');
    const year = yearValue(candidate);
    if (year !== undefined && year >= 1900) return year;
  }
  return undefined;
}
function tokenNumber(token: string): number | undefined {
  const digits = token.match(/^\d{1,4}(?:st|nd|rd|th)?$/)?.[0].replace(/(?:st|nd|rd|th)$/, '');
  return digits ? Number(digits) : numberWords(token);
}
function normalizedDate(year: number | undefined, month: number | undefined, day: number | undefined): string {
  const currentYear = new Date().getFullYear();
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31 || year < currentYear - 100 || year > currentYear) throw new Error('could not understand that date of birth');
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('that date of birth is not a real calendar date');
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}
export function normalizeDob(value: string): string {
  const original = value.trim().replace(/[’']/g, '').replace(/,/g, ' ');
  const tokens = original.toLowerCase().split(/[\s/\\.-]+/).filter(Boolean);
  const monthIndex = tokens.findIndex((token) => MONTHS[token] !== undefined);
  if (monthIndex >= 0) {
    const month = MONTHS[tokens[monthIndex]!]!;
    const rest = tokens.filter((_, i) => i !== monthIndex);
    const nums = rest.map(tokenNumber).filter((x): x is number => x !== undefined);
    const year = yearFromTokens(rest);
    const day = nums.find((n) => n >= 1 && n <= 31 && n !== year);
    return normalizedDate(year, month, day);
  }
  const numeric = tokens.map(tokenNumber).filter((x): x is number => x !== undefined);
  if (numeric.length === 3) {
    const [a, b, c] = numeric;
    const year = yearValue(tokens[2] ?? '') ?? (c! > 31 ? c : undefined);
    if (a! >= 1000) return normalizedDate(a, b, c);
    if (a! > 12 && b! <= 12) return normalizedDate(year, b, a);
    return normalizedDate(year, a, b); // ambiguous dates use the US month/day convention.
  }
  throw new Error('could not understand that date of birth; try month/day/year, day-month-year, or spell it out');
}
export function dobIsAmbiguous(value: string): boolean {
  return dobCandidates(value).length > 1;
}
export function dobCandidates(value: string): string[] {
  const tokens = value.trim().replace(/[’']/g, '').split(/[\s/\\.-]+/).filter(Boolean);
  if (tokens.length !== 3 || !/^\d{1,2}$/.test(tokens[0]!) || !/^\d{1,2}$/.test(tokens[1]!) || !/^\d{2,4}$/.test(tokens[2]!)) return [normalizeDob(value)];
  const a = Number(tokens[0]); const b = Number(tokens[1]); const rawYear = Number(tokens[2]);
  const years = tokens[2]!.length === 2 ? [1900 + rawYear, 2000 + rawYear] : [rawYear];
  const pairs = a >= 1 && a <= 12 && b >= 1 && b <= 12 ? [[a, b], [b, a]] : a > 12 ? [[b, a]] : [[a, b]];
  const candidates: string[] = [];
  for (const year of years) for (const [month, day] of pairs) {
    try { candidates.push(normalizedDate(year, month, day)); } catch { /* invalid candidate */ }
  }
  return [...new Set(candidates)];
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
