# Character Frequency Analyzer

Counts the occurrence of every Unicode code point in a string, with optional case folding and filtering, and exposes ranked frequencies plus the index of coincidence for cryptanalysis.

```js
import { analyze, topN, indexOfCoincidence, CaseFolding, caseInsensitive } from './src/index.js';

const result = analyze('Hello, World!', {
  caseFolding: CaseFolding.ASCII,
  filter: caseInsensitive
});

console.log(topN(result, 3));
// [{ char: 'l', count: 3, frequency: 0.3 }, { char: 'o', count: 2, frequency: 0.2 }, ...]

console.log(indexOfCoincidence(result));
```

## Why this exists

Frequency spectra are the starting point for classical cipher analysis and
simple text fingerprinting. Most implementations count UTF-16 code units,
which silently splits astral characters (emoji, historic scripts) across a
surrogate pair and corrupts the tally. This library iterates by code point
so each character counts as one unit.

The trade-off is memory: the full `Map` of counts is materialized in one
pass rather than streamed. That is fine for the kilobyte-to-megabyte texts
that show up in cryptanalysis homework and CTF challenges; it is the wrong
choice for multi-gigabyte corpora.

## Case folding

`CaseFolding.ASCII` lowercases only A–Z. Use it when comparing against a
classical 26-letter alphabet where touching non-ASCII characters would
change their identity. `CaseFolding.FULL` runs `String.prototype.toLowerCase`,
which performs the Unicode default case folding — the right call when Greek,
Cyrillic, or Latin Extended text should collapse case classes. The default
is `CaseFolding.NONE`.

## Awkward edge: `r.length` vs `r.total`

`analyze` returns both `length` (UTF-16 code units in the raw input) and
`total` (characters actually counted, after any filter). They diverge
whenever the input contains astral characters or a filter is applied. Use
`total` as the denominator for frequencies; `length` is there only so you
can sanity-check the shape of the input.

## Exported names

- `analyze(input, options?)` — `{ counts: Map<string, number>, total, unique, length }`
- `rankByFrequency(counts)` — `Array<[string, number]>` sorted by count desc, ties by code point asc
- `topN(result, n)` — `Array<{ char, count, frequency }>`
- `indexOfCoincidence(result)` — `number`, 0 for inputs under 2 characters
- `caseInsensitive(ch)` — predicate, true for ASCII letters only
- `lettersOnly(ch)` — predicate, true for ASCII + Latin-1 + Latin Extended-A letters
- `CaseFolding` — frozen object `{ NONE, ASCII, FULL }`

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

