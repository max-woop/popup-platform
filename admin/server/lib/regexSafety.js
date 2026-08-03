'use strict';

// Regex safety gate for targeting rules (§6.1): "validate patterns at save
// time — max 200 chars, reject nested quantifiers, enforce a match timeout."
// This is a heuristic, not a proof — it catches the common catastrophic-
// backtracking shapes (nested/adjacent quantifiers) without a full analyzer.
const NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)[+*]/;

function checkRegexSafety(pattern) {
  if (typeof pattern !== 'string') return { ok: false, reason: 'pattern must be a string' };
  if (pattern.length > 200) return { ok: false, reason: 'pattern exceeds 200 chars' };
  if (NESTED_QUANTIFIER.test(pattern)) return { ok: false, reason: 'nested quantifiers are not allowed (ReDoS risk)' };
  try { new RegExp(pattern); } catch (e) { return { ok: false, reason: 'not a valid regular expression' }; }
  return { ok: true };
}

module.exports = { checkRegexSafety };
