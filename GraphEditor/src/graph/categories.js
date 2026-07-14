/**
 * categories.js — the category → colour/symbol mapping for nodes, plus the
 * shared markup for a legend toggle button.
 *
 * A file's category is declared verbatim in its leading description comment
 * (`@category <name>`); this module just turns that string into a colour and a
 * symbol. Unknown or missing categories fall back to a neutral grey.
 *
 * Forward-compatible with the planned shift from a single `category` to an
 * ordered `tags[]` list: `primaryCategory()` reads `node.category`, or the
 * first element of `node.tags`, so adding tags later is additive.
 *
 * CUSTOM_KEY/CUSTOM_STYLE back the "custom" category that the embed API
 * (see filters.js `applyCustom`) populates from outside — e.g. the Design
 * site's graph column shows one, labelled after the doc heading it was opened
 * from. It is otherwise an ordinary category: same toggle, same legend markup.
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

export const CUSTOM_KEY = 'custom';
export const CUSTOM_STYLE = { color: '#46b3ff', symbol: '✦', label: 'Custom' };

// "modified" is another externally-populated category (from `git status` via the
// dev server — see filters.js `setModified`). Like custom, it's an ordinary
// toggleable legend entry; it takes priority over a node's real category so
// changed files stand out and can be isolated.
export const MODIFIED_KEY = 'modified';
export const MODIFIED_STYLE = { color: '#F97316', symbol: '✎', label: 'Modified' };

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

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Builds one legend toggle button (swatch + label) — the shared markup for
 *  both the static category legend and the dynamically-added "custom" entry. */
export function legendItemEl(key, { color, symbol, label }) {
  const item = document.createElement('span');
  item.className = 'legend-item';
  item.dataset.category = key;
  item.setAttribute('role', 'button');
  item.title = `Toggle ${label || key}`;
  item.innerHTML =
    `<span class="legend-swatch" style="color:${color}">${symbol}</span>` +
    escapeHtml(label || key);
  return item;
}
