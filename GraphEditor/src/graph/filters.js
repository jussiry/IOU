/**
 * filters.js — the top-bar visibility controls: the size filter and the
 * category toggles. Both hide nodes, so they share one recompute pass: a node
 * is visible only if it passes the size filter AND its category is enabled.
 *
 * Size filter — segmented control, three tiers (from each file's char count):
 *   all (everything) · medium (medium & large) · large (large only).
 * Category toggles — the legend swatches double as on/off buttons; clicking one
 *   hides every node of that category (and any edge touching a hidden node).
 *
 * Positions are left untouched (no relayout) so the surviving graph stays where
 * the user last saw it.
 */

const SIZE_VISIBLE = {
  all: new Set(['small', 'medium', 'large']),
  medium: new Set(['medium', 'large']),
  large: new Set(['large']),
};

// Legend key used for nodes that have no category.
export const UNCATEGORISED = '(uncategorised)';

export function setupFilters({ nodes, edges, sizeContainer, legendContainer, onChange }) {
  let sizeMode = 'all';
  const disabledCategories = new Set();

  const categoryKey = (n) => n.category || UNCATEGORISED;

  function recompute() {
    const sizeOk = SIZE_VISIBLE[sizeMode] || SIZE_VISIBLE.all;
    for (const n of nodes) {
      n._hidden = !sizeOk.has(n.sizeTier || 'small') || disabledCategories.has(categoryKey(n));
      n._el.classList.toggle('node-hidden', n._hidden);
    }
    for (const e of edges) {
      e._line.classList.toggle('edge-hidden', e.source._hidden || e.target._hidden);
    }
    onChange && onChange(nodes.filter((n) => !n._hidden).length);
  }

  // Size segmented control.
  const sizeButtons = [...sizeContainer.querySelectorAll('button[data-filter]')];
  for (const b of sizeButtons) {
    b.addEventListener('click', () => {
      sizeMode = b.dataset.filter;
      for (const x of sizeButtons) x.classList.toggle('active', x === b);
      recompute();
    });
  }

  // Category toggles (legend swatches). Clicking dims the label and hides its
  // nodes; clicking again restores them.
  const catButtons = [...legendContainer.querySelectorAll('[data-category]')];
  for (const b of catButtons) {
    b.addEventListener('click', () => {
      const key = b.dataset.category;
      if (disabledCategories.has(key)) disabledCategories.delete(key);
      else disabledCategories.add(key);
      b.classList.toggle('legend-off', disabledCategories.has(key));
      syncToggleAll();
      recompute();
    });
  }

  // Toggle-all button: when all categories are on it turns all off, otherwise
  // it turns all on. Symbol: ◎ (all on) / ○ (all off).
  const toggleAllBtn = legendContainer.querySelector('#legend-toggle-all');
  const allKeys = catButtons.map((b) => b.dataset.category);

  function syncToggleAll() {
    if (!toggleAllBtn) return;
    const allOff = allKeys.every((k) => disabledCategories.has(k));
    toggleAllBtn.textContent = allOff ? '○' : '◎';
    toggleAllBtn.title = allOff ? 'Show all categories' : 'Hide all categories';
  }

  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      const allOff = allKeys.every((k) => disabledCategories.has(k));
      if (allOff) {
        allKeys.forEach((k) => disabledCategories.delete(k));
      } else {
        allKeys.forEach((k) => disabledCategories.add(k));
      }
      catButtons.forEach((b) => b.classList.toggle('legend-off', disabledCategories.has(b.dataset.category)));
      syncToggleAll();
      recompute();
    });
    syncToggleAll();
  }

  recompute();
  return { recompute };
}
