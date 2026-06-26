/**
 * categories.js — the category → colour/symbol mapping for nodes.
 *
 * A file's category is declared verbatim in its leading description comment
 * (`@category <name>`); this module just turns that string into a colour and a
 * symbol. Unknown or missing categories fall back to a neutral grey.
 *
 * Forward-compatible with the planned shift from a single `category` to an
 * ordered `tags[]` list: `primaryCategory()` reads `node.category`, or the
 * first element of `node.tags`, so adding tags later is additive.
 */

export const CATEGORIES = {
  ui:       { color: '#4F86C6', symbol: '▢', label: 'UI' },
  data:     { color: '#9B6BD6', symbol: '◆', label: 'Data' },
  network:  { color: '#16A6A6', symbol: '⇄', label: 'Network' },
  crypto:   { color: '#C2473D', symbol: '⚿', label: 'Crypto' },
  util:     { color: '#6B7280', symbol: '⚙', label: 'Util' },
  command:  { color: '#D6557F', symbol: '▶', label: 'Command' },
  entry:    { color: '#2FA84F', symbol: '★', label: 'Entry' },
  test:     { color: '#D9A521', symbol: '✓', label: 'Test' },
  external: { color: '#E0772B', symbol: '◇', label: 'External' },
};

export const FALLBACK = { color: '#94A3B8', symbol: '•', label: 'Uncategorised' };

/** The primary category string for a node, or null. */
export function primaryCategory(node) {
  if (node.category) return node.category;
  if (Array.isArray(node.tags) && node.tags.length) return node.tags[0];
  return null;
}

/** Resolve a node's category to its visual descriptor (never null). */
export function styleFor(node) {
  return CATEGORIES[primaryCategory(node)] || FALLBACK;
}
