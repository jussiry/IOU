/**
 * exports.js — counts the exported symbols of a source file.
 *
 * Distinguishes function exports from constant exports so the card can show
 * two separate counts. The heuristic is purely text-based (no AST), which is
 * fast and accurate enough for well-formatted source files.
 *
 * Counted as functions:
 *   export function foo / export async function foo / export default function
 *   export const foo = () => ...    (arrow fn, parens form)
 *   export const foo = async () => ...
 *   export const foo = x => ...     (single-param arrow, no parens)
 *   export const foo = function ...
 *   export const foo = async function ...
 *
 * Counted as constants:
 *   export const FOO = <anything that is not a function literal>
 *   export let foo = ...
 *   export var foo = ...
 *
 * Skipped (type-only or re-export forms that don't add new values):
 *   export type / export interface / export { ... }
 */

// Matches `export [async] function name` and `export default [async] function`.
const DIRECT_FN = /^export\s+(?:default\s+)?(?:async\s+)?function\b/mg;

// Matches `export const name = <rest of line>` — we inspect <rest> to decide fn vs const.
const CONST_EXPORT = /^export\s+const\s+\w+\s*=[ \t]*([^\n]*)/mg;

// Matches `export let/var name = ...` — always counted as constants.
const LET_VAR_EXPORT = /^export\s+(?:let|var)\s+\w+\s*=/mg;

function isFunctionRhs(rhs) {
  const s = rhs.trim();
  // arrow function (with or without async, with or without parens)
  if (/^(?:async\s+)?(?:\(|function\b)/.test(s)) return true;
  // single-identifier arrow: `x =>`
  if (/^\w+\s*=>/.test(s)) return true;
  return false;
}

export function countExports(src) {
  let fns = 0, consts = 0;

  for (const _ of src.matchAll(DIRECT_FN)) fns++;

  for (const m of src.matchAll(CONST_EXPORT)) {
    if (isFunctionRhs(m[1])) fns++;
    else consts++;
  }

  for (const _ of src.matchAll(LET_VAR_EXPORT)) consts++;

  return { fns, consts };
}
