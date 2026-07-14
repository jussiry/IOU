/**
 * filters.js — the top-bar visibility controls: the size filter and the
 * category toggles (including "custom", populated from outside). All hide
 * nodes, so they share one recompute pass.
 *
 * Size filter — segmented control, three tiers (from each file's char count):
 *   all (everything) · medium (medium & large) · large (large only).
 * Category toggles — the legend swatches double as on/off buttons; clicking one
 *   hides every node of that category (and any edge touching a hidden node).
 * Custom category — an explicit list of node ids pushed in from outside (the
 *   embed API: see main.js `showNodes`). `applyCustom()` tags the matching
 *   nodes with the synthetic "custom" category (taking priority over their
 *   real one) and adds it to the legend like any other entry — same swatch
 *   markup, same toggle, no special styling or fixed position. The one bit of
 *   special handling is on arrival: every other category switches off so the
 *   requested set is exactly what's shown; from then on "custom" behaves
 *   exactly like the rest and the user is free to toggle any of them.
 *
 * Positions are left untouched (no relayout) so the surviving graph stays where
 * the user last saw it.
 */

import { CUSTOM_KEY, CUSTOM_STYLE, MODIFIED_KEY, MODIFIED_STYLE, legendItemEl } from './categories.js';

const SIZE_VISIBLE = {
  all: new Set(['small', 'medium', 'large']),
  medium: new Set(['medium', 'large']),
  large: new Set(['large']),
};

// Legend key used for nodes that have no category.
export const UNCATEGORISED = '(uncategorised)';

// Normalise a file reference so doc metadata can be written either as the graph
// node id ("js/peer/mesh.js") or with the analysed root prefix
// ("app/js/peer/mesh.js") or a leading "./" — all resolve to the same node.
function normaliseRef(s) {
  return String(s).trim().replace(/^\.?\//, '').replace(/^app\//, '');
}

export function setupFilters({ nodes, edges, sizeContainer, legendContainer, onChange, onLegendChange }) {
  let sizeMode = 'all';
  const disabledCategories = new Set();
  let customIds = null;   // Set<normalised ref> | null — populated by applyCustom()
  let modifiedIds = null; // Set<normalised ref> | null — populated by setModified()
  let customBtn = null;   // the legend entries for the two synthetic categories,
  let modifiedBtn = null; // added/removed as their sets come and go

  const inSet = (n, set) => set.has(normaliseRef(n.id)) || (n.path && set.has(normaliseRef(n.path)));
  const categoryKey = (n) => {
    if (customIds && inSet(n, customIds)) return CUSTOM_KEY;      // custom wins over
    if (modifiedIds && inSet(n, modifiedIds)) return MODIFIED_KEY; // modified wins over
    return n.category || UNCATEGORISED;                            // the real category
  };

  function recompute() {
    const sizeOk = SIZE_VISIBLE[sizeMode] || SIZE_VISIBLE.all;
    for (const n of nodes) {
      const sizePass = sizeOk.has(n.sizeTier || 'small');
      n._hidden = !(sizePass && !disabledCategories.has(categoryKey(n)));
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

  // Category toggles (legend swatches). Clicking behaves as an isolate/expand
  // shortcut, falling back to a plain toggle in the middle:
  //   - everything on            → clicking a category isolates it (hides the rest)
  //   - only this category on     → clicking it shows all again
  //   - some (but not all) on     → clicking toggles just that category on/off
  // `catButtons` stays in sync as entries are added/removed (the synthetic
  // "custom"/"modified" entries come and go at runtime), so this wiring and the
  // toggle-all button below always see the current set.
  const catButtons = [];
  function syncLegendOff() {
    for (const b of catButtons) b.classList.toggle('legend-off', disabledCategories.has(b.dataset.category));
  }
  function wireCategoryButton(btn) {
    catButtons.push(btn);
    btn.addEventListener('click', () => {
      const key = btn.dataset.category;
      const keys = catButtons.map((b) => b.dataset.category);
      const enabled = keys.filter((k) => !disabledCategories.has(k));
      const allOn = enabled.length === keys.length;
      const onlyThisOn = enabled.length === 1 && enabled[0] === key;

      if (allOn) {
        for (const k of keys) if (k !== key) disabledCategories.add(k); // isolate this one
      } else if (onlyThisOn) {
        disabledCategories.clear(); // this was the only one → show all
      } else if (disabledCategories.has(key)) {
        disabledCategories.delete(key);
      } else {
        disabledCategories.add(key);
      }

      syncLegendOff();
      syncToggleAll();
      recompute();
    });
  }
  for (const b of legendContainer.querySelectorAll('[data-category]')) wireCategoryButton(b);

  // Toggle-all button: when all categories are on it turns all off, otherwise
  // it turns all on. Symbol: ◎ (all on) / ○ (all off).
  const toggleAllBtn = legendContainer.querySelector('#legend-toggle-all');

  function syncToggleAll() {
    if (!toggleAllBtn) return;
    const allOff = catButtons.length > 0 && catButtons.every((b) => disabledCategories.has(b.dataset.category));
    toggleAllBtn.textContent = allOff ? '○' : '◎';
    toggleAllBtn.title = allOff ? 'Show all categories' : 'Hide all categories';
  }

  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      const allOff = catButtons.length > 0 && catButtons.every((b) => disabledCategories.has(b.dataset.category));
      for (const b of catButtons) {
        if (allOff) disabledCategories.delete(b.dataset.category);
        else disabledCategories.add(b.dataset.category);
      }
      syncLegendOff();
      syncToggleAll();
      recompute();
    });
    syncToggleAll();
  }

  // --- Synthetic categories (populated from outside) ------------------------
  function removeButton(btn) {
    if (!btn) return;
    const idx = catButtons.indexOf(btn);
    if (idx >= 0) catButtons.splice(idx, 1);
    btn.remove();
  }

  function applyCustom(refs, label) {
    const list = Array.isArray(refs) ? refs : String(refs || '').split(/[\s,]+/);
    customIds = new Set(list.map(normaliseRef).filter(Boolean));

    removeButton(customBtn);
    customBtn = legendItemEl(CUSTOM_KEY, { ...CUSTOM_STYLE, label: (label && String(label).trim()) || CUSTOM_STYLE.label });
    legendContainer.appendChild(customBtn); // same position any new category would take: after the rest
    wireCategoryButton(customBtn);

    // A fresh custom set replaces whatever was visible: show exactly these
    // files by switching every other category off. Toggling is free-form again
    // from here until the next applyCustom()/clearCustom().
    disabledCategories.clear();
    for (const b of catButtons) if (b !== customBtn) disabledCategories.add(b.dataset.category);
    syncLegendOff();

    syncToggleAll();
    onLegendChange && onLegendChange();
    recompute();
  }

  function clearCustom() {
    if (!customIds) return;
    customIds = null;
    removeButton(customBtn);
    customBtn = null;
    disabledCategories.clear(); // back to showing everything
    syncLegendOff();
    syncToggleAll();
    onLegendChange && onLegendChange();
    recompute();
  }

  // The "modified" category: the set of files changed since the last commit,
  // pushed in from the dev server's git status (see main.js). Added to the
  // legend as an ordinary, on-by-default toggle; passing an empty list removes
  // it. Its enabled/disabled state is preserved across refreshes.
  function setModified(refs) {
    const list = (Array.isArray(refs) ? refs : String(refs || '').split(/[\s,]+/)).map(normaliseRef).filter(Boolean);
    modifiedIds = list.length ? new Set(list) : null;

    if (!modifiedIds) {
      removeButton(modifiedBtn);
      modifiedBtn = null;
    } else if (!modifiedBtn) {
      modifiedBtn = legendItemEl(MODIFIED_KEY, MODIFIED_STYLE);
      // Sit before the custom entry (if any) so custom stays last.
      if (customBtn) legendContainer.insertBefore(modifiedBtn, customBtn);
      else legendContainer.appendChild(modifiedBtn);
      wireCategoryButton(modifiedBtn);
    }
    syncToggleAll();
    onLegendChange && onLegendChange();
    recompute();
  }

  recompute();
  return { recompute, applyCustom, clearCustom, hasCustom: () => !!customIds, setModified, hasModified: () => !!modifiedIds };
}
