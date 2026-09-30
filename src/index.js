import { analyze, rankByFrequency, topN, indexOfCoincidence, caseInsensitive, lettersOnly, CaseFolding } from './core.js';

/**
 * Re-exports every public name from core.js so users import from one path:
 *
 *   import { analyze, topN } from 'charfreq';
 *
 * Nothing is re-wrapped or renamed; the README documents exactly these names.
 */
export {
  analyze,
  rankByFrequency,
  topN,
  indexOfCoincidence,
  caseInsensitive,
  lettersOnly,
  CaseFolding
};
