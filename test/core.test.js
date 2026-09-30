import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyze,
  rankByFrequency,
  topN,
  indexOfCoincidence,
  caseInsensitive,
  lettersOnly,
  CaseFolding
} from '../src/core.js';

test('analyze tallies each character exactly', () => {
  const r = analyze('aab');
  assert.equal(r.counts.get('a'), 2);
  assert.equal(r.counts.get('b'), 1);
  assert.equal(r.total, 3);
  assert.equal(r.unique, 2);
});

// Iterating by code point (for...of) means astral characters are one
// unit, not a surrogate pair. This is the central Unicode correctness
// property of the implementation.
test('analyze treats surrogate pairs as single characters', () => {
  const emoji = '💩';
  assert.equal(emoji.length, 2); // two UTF-16 code units
  const r = analyze(emoji);
  assert.equal(r.counts.get(emoji), 1);
  assert.equal(r.total, 1);
  assert.equal(r.unique, 1);
  assert.equal(r.length, 2);
});

test('analyze on empty string produces an empty tally', () => {
  const r = analyze('');
  assert.equal(r.counts.size, 0);
  assert.equal(r.total, 0);
  assert.equal(r.unique, 0);
  assert.equal(r.length, 0);
});

test('analyze rejects non-string input', () => {
  assert.throws(() => analyze(42), TypeError);
  assert.throws(() => analyze(null), TypeError);
  assert.throws(() => analyze(undefined), TypeError);
});

test('ascii case folding lowercases A-Z only', () => {
  const r = analyze('AbC', { caseFolding: CaseFolding.ASCII });
  assert.equal(r.counts.get('a'), 1);
  assert.equal(r.counts.get('b'), 1);
  assert.equal(r.counts.get('c'), 1);
  assert.equal(r.counts.get('A'), undefined);
});

// The whole point of ASCII folding is to not corrupt non-ASCII code points.
// Latin-1 letters with uppercase forms must stay untouched under ASCII mode.
test('ascii folding leaves Latin-1 uppercase letters unchanged', () => {
  const r = analyze('É', { caseFolding: CaseFolding.ASCII });
  assert.equal(r.counts.get('É'), 1);
  assert.equal(r.counts.get('é'), undefined);
});

test('full case folding applies String.prototype.toLowerCase', () => {
  const r = analyze('AbC', { caseFolding: CaseFolding.FULL });
  assert.equal(r.counts.get('a'), 1);
  assert.equal(r.counts.get('b'), 1);
  assert.equal(r.counts.get('c'), 1);
  assert.equal(r.counts.get('A'), undefined);
});

test('default case folding is none and preserves case', () => {
  const r = analyze('Aa');
  assert.equal(r.counts.get('A'), 1);
  assert.equal(r.counts.get('a'), 1);
  assert.equal(r.unique, 2);
});

test('unknown caseFolding mode throws RangeError', () => {
  assert.throws(() => analyze('x', { caseFolding: 'weird' }), RangeError);
});

test('filter excludes characters for which it returns false', () => {
  const r = analyze('a1b2c', { filter: lettersOnly });
  assert.equal(r.counts.get('a'), 1);
  assert.equal(r.counts.get('b'), 1);
  assert.equal(r.counts.get('c'), 1);
  assert.equal(r.counts.get('1'), undefined);
  assert.equal(r.counts.get('2'), undefined);
  assert.equal(r.total, 3);
});

test('caseInsensitive filter matches only ASCII letters', () => {
  assert.equal(caseInsensitive('A'), true);
  assert.equal(caseInsensitive('z'), true);
  assert.equal(caseInsensitive('0'), false);
  assert.equal(caseInsensitive(' '), false);
  assert.equal(caseInsensitive('É'), false);
});

test('caseInsensitive filter combined with ascii folding collapses case', () => {
  const r = analyze('Hello, World!', {
    caseFolding: CaseFolding.ASCII,
    filter: caseInsensitive
  });
  assert.equal(r.counts.get('h'), 1);
  assert.equal(r.counts.get('e'), 1);
  assert.equal(r.counts.get('l'), 3);
  assert.equal(r.counts.get('o'), 2);
  assert.equal(r.counts.get('w'), 1);
  assert.equal(r.counts.get('r'), 1);
  assert.equal(r.counts.get('d'), 1);
  assert.equal(r.counts.get('!'), undefined);
  assert.equal(r.counts.get(','), undefined);
  assert.equal(r.counts.get(' '), undefined);
  assert.equal(r.total, 10);
});

test('rankByFrequency sorts by count descending then by code point ascending', () => {
  const r = analyze('baaa');
  // a:3, b:1 — a comes first by count.
  const ranked = rankByFrequency(r.counts);
  assert.deepEqual(ranked, [['a', 3], ['b', 1]]);
});

test('rankByFrequency breaks ties deterministically by code point', () => {
  // a and b both appear twice — tie. a (U+0061) sorts before b (U+0062).
  const r = analyze('abab');
  const ranked = rankByFrequency(r.counts);
  assert.deepEqual(ranked, [['a', 2], ['b', 2]]);
});

test('rankByFrequency rejects non-Map input', () => {
  assert.throws(() => rankByFrequency({}), TypeError);
  assert.throws(() => rankByFrequency(null), TypeError);
});

test('topN returns the most frequent characters with frequency', () => {
  const r = analyze('aaabb');
  const top = topN(r, 1);
  assert.equal(top.length, 1);
  assert.deepEqual(top[0], { char: 'a', count: 3, frequency: 0.6 });
});

test('topN clamps n to available distinct characters', () => {
  const r = analyze('ab');
  const top = topN(r, 10);
  assert.equal(top.length, 2);
});

test('topN on empty input returns an empty array with no NaN', () => {
  const r = analyze('');
  const top = topN(r, 5);
  assert.deepEqual(top, []);
});

test('topN with n=0 returns an empty array', () => {
  const r = analyze('abc');
  assert.deepEqual(topN(r, 0), []);
});

test('topN rejects negative or non-finite n', () => {
  const r = analyze('abc');
  assert.throws(() => topN(r, -1), RangeError);
  assert.throws(() => topN(r, Infinity), RangeError);
  assert.throws(() => topN(r, NaN), RangeError);
});

test('indexOfCoincidence matches the textbook formula', () => {
  // 'aaabb' → Σ n(n-1) = 3·2 + 2·1 = 8; N(N-1) = 5·4 = 20; IC = 0.4
  const r = analyze('aaabb');
  assert.equal(indexOfCoincidence(r), 0.4);
});

test('indexOfCoincidence returns 0 when fewer than 2 characters', () => {
  assert.equal(indexOfCoincidence(analyze('')), 0);
  assert.equal(indexOfCoincidence(analyze('a')), 0);
});

test('indexOfCoincidence for a uniformly distributed alphabet', () => {
  // Each of a,b,c,d once → Σ = 0; IC = 0.
  const r = analyze('abcd');
  assert.equal(indexOfCoincidence(r), 0);
});
