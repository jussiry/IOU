/**
 * exports.js — extracts a file's exported symbols, split into functions and
 * constants, with each symbol's source text.
 *
 * The graph card renders these in a small code editor: functions show their
 * signature (body folded), constants show their value (single-line inline,
 * multi-line folded). So per symbol we keep the *whole* export statement's
 * source — CodeMirror folds the multi-line ones down to their first line.
 *
 * Extraction is text-based (no AST), which is fast and good enough for the
 * well-formatted, semicolon-terminated source this codebase uses. For each
 * top-level `export` we capture the full statement by scanning forward until
 * brackets balance and the line ends a statement, ignoring braces inside
 * strings/templates/comments.
 *
 * Classified as functions:
 *   export [default] [async] function foo(...)      · export class Foo
 *   export const foo = (…) => …   ·   = async (…) => …   ·   = x => …
 *   export const foo = function … ·   = async function …
 * Classified as constants:
 *   export const/let/var NAME = <anything that isn't a function literal>
 * Skipped (add no new value binding):
 *   export { … } · export * … · export type … · export interface …
 */

function isFunctionRhs(rhs) {
  const s = rhs.trim();
  if (/^(?:async\s+)?(?:\(|function\b)/.test(s)) return true; // arrow(parens) / function-expr
  if (/^\w+\s*=>/.test(s)) return true;                        // single-param arrow: x =>
  return false;
}

// From line index `start`, accumulate lines until brackets balance and the line
// terminates the statement. String/template/comment aware so their braces don't
// throw off the depth count. Returns the statement text and its last line index.
function readStatement(lines, start) {
  let depth = 0, inStr = null, inBlock = false, esc = false;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    let inLine = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j], n = line[j + 1];
      if (inLine) break;
      if (inBlock) { if (c === '*' && n === '/') { inBlock = false; j++; } continue; }
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '/' && n === '/') { inLine = true; continue; }
      if (c === '/' && n === '*') { inBlock = true; j++; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
    if (!inStr && !inBlock && depth <= 0) {
      const t = line.trimEnd();
      // Ends the statement when the line closes it, or the next line starts a
      // new top-level statement (covers the rare no-semicolon single-liner).
      if (/[;}]$/.test(t)) return { code: out.join('\n'), end: i };
      if (t !== '' && !/[,([{=&|+\-*/?:<>.]$/.test(t)) return { code: out.join('\n'), end: i };
    }
  }
  return { code: out.join('\n'), end: lines.length - 1 };
}

function classify(line) {
  if (/^export\s+(type|interface)\b/.test(line)) return null;
  if (/^export\s*\{/.test(line) || /^export\s+\*/.test(line)) return null;

  let m = line.match(/^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)?/);
  if (m) return { kind: 'fns', name: m[1] || 'default' };

  m = line.match(/^export\s+class\s+([A-Za-z0-9_$]+)/);
  if (m) return { kind: 'fns', name: m[1] };

  m = line.match(/^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=(.*)$/);
  if (m) return { kind: isFunctionRhs(m[2]) ? 'fns' : 'consts', name: m[1] };

  return null;
}

export function extractExports(src) {
  const lines = src.split('\n');
  const fns = [], consts = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^export\b/.test(lines[i])) continue;
    const info = classify(lines[i]);
    const { code, end } = readStatement(lines, i);
    if (info) {
      // Strip the leading `export`/`export default` — the editor is all exports.
      const display = code.replace(/^export\s+(?:default\s+)?/, '');
      (info.kind === 'fns' ? fns : consts).push({ name: info.name, code: display });
    }
    i = end; // skip past the consumed statement
  }
  return { fns, consts };
}
