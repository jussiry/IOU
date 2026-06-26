/**
 * describe.js — extracts a file's leading description comment and its
 * `@category` tag.
 *
 * Convention (as used across the IOU codebase): each file opens with a block
 * comment describing what the module does. We take that first `/* ... *\/`
 * block as the node's description, strip comment decoration, and pull out the
 * `@category <name>` line (which is removed from the visible description).
 *
 * Files without a leading block comment get an empty description and no
 * category (the visualiser then shows the neutral fallback).
 */

const LEADING_BLOCK = /^\s*\/\*([\s\S]*?)\*\//;

export function describe(src) {
  const match = src.match(LEADING_BLOCK);
  if (!match) return { description: '', category: null };

  let body = match[1];

  // Pull out the @category tag, if present.
  let category = null;
  const cat = body.match(/^[ \t*]*@category[ \t]+([^\s*]+)/m);
  if (cat) {
    category = cat[1];
    body = body.replace(cat[0], '');
  }

  // Strip leading "*" decoration and trim blank edges.
  const description = body
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();

  return { description, category };
}
