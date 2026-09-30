/**
 * Character Frequency Analyzer
 *
 * Counts occurrences of each Unicode code point in a string. The API is
 * deliberately synchronous and dependency-free so it can be embedded in
 * analysis pipelines that run on a worker thread or in a constrained
 * runtime.
 */

/**
 * Case-folding strategy applied before counting.
 *
 * - "none"  — characters are counted exactly as they appear in the input.
 * - "ascii" — only A–Z are lowercased; useful when comparing against
 *             classical cipher alphabets that never contained non-ASCII.
 * - "full"  — `String.prototype.toLowerCase` is used, which performs the
 *             full Unicode default case folding. This is the right choice
 *             when Greek, Cyrillic, etc. should collapse case classes.
 */
export const CaseFolding = Object.freeze({
  NONE: 'none',
  ASCII: 'ascii',
  FULL: 'full'
});

/**
 * Predicate-based filter: include a character in the tally iff `fn` returns truthy.
 * @type {(ch: string) => boolean}
 */
export function lettersOnly(ch) {
  // Ranges cover every major ASCII letter block. Digits, whitespace,
  // punctuation and symbols are excluded so frequency spectra resemble
  // those used in classical cryptanalysis.
  const c = ch.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5A) || // A-Z
         (c >= 0x61 && c <= 0x7A) || // a-z
         (c >= 0xC0 && c <= 0xFF) || // Latin-1 Supplement letters
         (c >= 0x100 && c <= 0x17F); // Latin Extended-A
}

/**
 * Shortcut filter matching the "ASCII letters only" case-folding,
 * but usable on its own for pure alphabetic spectra.
 */
export function caseInsensitive(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A);
}

function foldCase(ch, mode) {
  switch (mode) {
    case CaseFolding.NONE:
      return ch;
    case CaseFolding.ASCII: {
      const c = ch.charCodeAt(0);
      // Only fold A-Z. Touching non-ASCII characters with toLowerCase
      // would change their identity, which corrupts frequency counts
      // when the caller did not ask for full Unicode folding.
      if (c >= 0x41 && c <= 0x5A) return String.fromCharCode(c + 0x20);
      return ch;
    }
    case CaseFolding.FULL:
      return ch.toLowerCase();
    default:
      // Unknown modes are a programming error; surface it loudly
      // rather than silently producing wrong data.
      throw new RangeError(`Unknown CaseFolding mode: ${String(mode)}`);
  }
}

/**
 * Result of {@link analyze}. The Map's iteration order is insertion order
 * of code points as first encountered in the input.
 * @typedef {Object} AnalysisResult
 * @property {Map<string, number>} counts        character → count
 * @property {number} total                        number of characters counted (post-filter)
 * @property {number} unique                       number of distinct characters
 * @property {number} length                       number of UTF-16 code units in the original input
 */

/**
 * Count every character in `input`.
 *
 * @param {string} input
 * @param {Object}  [options]
 * @param {string}  [options.caseFolding=CaseFolding.NONE]  one of the CaseFolding values
 * @param {(ch: string) => boolean} [options.filter]        keep only characters for which this returns true
 * @returns {AnalysisResult}
 */
export function analyze(input, options) {
  if (typeof input !== 'string') {
    throw new TypeError('input must be a string');
  }
  const opts = options || {};
  const mode = opts.caseFolding ?? CaseFolding.NONE;
  const filter = typeof opts.filter === 'function' ? opts.filter : null;

  const counts = new Map();
  let total = 0;

  // Iterate by code point so that astral characters (e.g. emojis) are
  // counted as one unit rather than split into a surrogate pair.
  // for...of on a string uses String.prototype[Symbol.iterator],
  // which yields code points, not UTF-16 code units.
  for (const ch of input) {
    const folded = foldCase(ch, mode);
    if (filter !== null && !filter(folded)) continue;
    const prev = counts.get(folded);
    counts.set(folded, prev === undefined ? 1 : prev + 1);
    total += 1;
  }

  return {
    counts,
    total,
    unique: counts.size,
    length: input.length // UTF-16 code unit length, for debugging input shape
  };
}

/**
 * Return entries sorted by descending count, ties broken by ascending
 * character code point so that ordering is deterministic.
 *
 * @param {Map<string, number>} counts
 * @returns {Array<[string, number]>}
 */
export function rankByFrequency(counts) {
  if (!(counts instanceof Map)) {
    throw new TypeError('counts must be a Map');
  }
  const entries = Array.from(counts.entries());
  // Two-level sort: primary by count desc, secondary by code point asc.
  // The secondary key is what makes this deterministic for ties.
  entries.sort((a, b) => {
    const d = b[1] - a[1];
    if (d !== 0) return d;
    return codePoint(a[0]) - codePoint(b[0]);
  });
  return entries;
}

function codePoint(ch) {
  // String.prototype.codePointAt is safe for any string of length ≥ 1.
  return ch.codePointAt(0);
}

/**
 * Top-N most frequent characters, with `count` and `frequency` (0–1).
 * If `n` exceeds available distinct characters, returns as many as exist.
 *
 * @param {AnalysisResult} result
 * @param {number} n
 * @returns {Array<{char: string, count: number, frequency: number}>}
 */
export function topN(result, n) {
  if (!result || !(result.counts instanceof Map)) {
    throw new TypeError('result must be an AnalysisResult from analyze()');
  }
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new RangeError('n must be a non-negative finite number');
  }
  const ranked = rankByFrequency(result.counts);
  const take = Math.min(Math.floor(n), ranked.length);
  const out = new Array(take);
  const total = result.total;
  for (let i = 0; i < take; i++) {
    const [char, count] = ranked[i];
    // Dividing by zero would give NaN; guard explicitly so frequencies
    // are always numbers, even for an empty input.
    const frequency = total > 0 ? count / total : 0;
    out[i] = { char, count, frequency };
  }
  return out;
}

/**
 * Index of Coincidence (IC) — the probability that two independently drawn
 * characters from the sample are the same.
 *
 *   IC = Σ n_i(n_i − 1) / (N(N − 1))
 *
 * Defined as 0 for inputs with fewer than 2 counted characters.
 *
 * @param {AnalysisResult} result
 * @returns {number}
 */
export function indexOfCoincidence(result) {
  if (!result || !(result.counts instanceof Map)) {
    throw new TypeError('result must be an AnalysisResult from analyze()');
  }
  const N = result.total;
  if (N < 2) return 0;
  let sum = 0;
  for (const c of result.counts.values()) {
    sum += c * (c - 1);
  }
  return sum / (N * (N - 1));
}
