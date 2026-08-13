import test from 'node:test';
import assert from 'node:assert/strict';
import { dobCandidates, dobIsAmbiguous, normalizeDob } from '../dist/recovery.js';

/**
 * Wider format matrix for normalizeDob() beyond test/protocol.test.js's basic
 * cases — this parser gates access to someone's own recovery card, so a
 * misparse either locks the right person out or lets a PIN-guesser in.
 */

test('hyphenated ordinal days combine correctly (twenty-first, not twenty + first)', () => {
  assert.equal(normalizeDob('March twenty-first, 1984'), '1984-03-21');
  assert.equal(normalizeDob('twenty-first of March 1984'), '1984-03-21');
  assert.equal(normalizeDob('January thirty-first 1990'), '1990-01-31');
  // Space instead of hyphen tokenizes identically — same fix path.
  assert.equal(normalizeDob('March twenty first 1984'), '1984-03-21');
});

test('single-token spelled ordinals still resolve directly (no hyphen involved)', () => {
  assert.equal(normalizeDob('March twentieth 1984'), '1984-03-20');
  assert.equal(normalizeDob('March third 1984'), '1984-03-03');
  assert.equal(normalizeDob('March ninth 1984'), '1984-03-09');
});

test('two-digit years land on the correct side of the century boundary', () => {
  // yearValue(): <=29 -> 20xx, >=30 -> 19xx. Picked well clear of "today" in
  // either direction, since normalizedDate() also rejects a future birth
  // year — 06/25/29 would itself be a real future-year rejection depending
  // on when this runs, not a boundary-mapping failure; not what this checks.
  assert.equal(normalizeDob('06/25/15'), '2015-06-25');
  assert.equal(normalizeDob('06/25/60'), '1960-06-25');
  assert.equal(normalizeDob('06/25/00'), '2000-06-25');
  assert.equal(normalizeDob('06/25/99'), '1999-06-25');
});

test('mixed separators (slash, dash, dot, space) all tokenize the same way', () => {
  assert.equal(normalizeDob('06/25/1984'), '1984-06-25');
  assert.equal(normalizeDob('06-25-1984'), '1984-06-25');
  assert.equal(normalizeDob('06.25.1984'), '1984-06-25');
  assert.equal(normalizeDob('06 25 1984'), '1984-06-25');
  assert.equal(normalizeDob('06/25-1984'), '1984-06-25'); // mixed within one value
});

test('day-first (international) numeric order is inferred when the first number exceeds 12', () => {
  assert.equal(normalizeDob('25/06/1984'), '1984-06-25'); // 25 can't be a month
  assert.equal(normalizeDob('13/02/1980'), '1980-02-13'); // matches existing dobIsAmbiguous fixture
});

test('additional ambiguous-date cases beyond the existing 01/02/1980 fixture', () => {
  // Both day<=12 and month<=12: genuinely ambiguous, multiple valid calendar dates.
  assert.equal(dobIsAmbiguous('03/04/1990'), true);
  assert.deepEqual(new Set(dobCandidates('03/04/1990')), new Set(['1990-03-04', '1990-04-03']));

  assert.equal(dobIsAmbiguous('11/12/1975'), true);
  assert.deepEqual(new Set(dobCandidates('11/12/1975')), new Set(['1975-11-12', '1975-12-11']));

  // A century-boundary 2-digit year: one candidate year is filtered out by the
  // "no more than 100 years old" rule in normalizedDate(), same mechanism the
  // existing '01-01-01' fixture in protocol.test.js relies on.
  assert.equal(dobCandidates('05-06-29').length >= 1, true);
});

test('an invalid calendar date is rejected outright, not silently coerced', () => {
  assert.throws(() => normalizeDob('February 30, 1990'));
  assert.throws(() => normalizeDob('13/13/1990')); // no valid month/day interpretation
  assert.throws(() => normalizeDob('not a date at all'));
});

test('a year outside the plausible 100-year window is rejected', () => {
  const currentYear = new Date().getFullYear();
  assert.throws(() => normalizeDob(`01/01/${currentYear + 1}`)); // future
  assert.throws(() => normalizeDob(`01/01/${currentYear - 101}`)); // implausibly old
});
