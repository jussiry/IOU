/**
 * size-filter.js — the top-bar control that hides smaller files so the big,
 * structurally important modules stand out.
 *
 * Three tiers (computed in build.js from each file's character count):
 *   - all     : show everything
 *   - medium  : hide `small` files (show medium & large)
 *   - large   : show only `large` files
 *
 * Hiding a node also hides every edge touching it. Positions are left as-is
 * (no relayout) so the surviving graph stays where the user last saw it.
 */

// Which tiers are visible for each filter mode.
const VISIBLE = {
  all: new Set(['small', 'medium', 'large']),
  medium: new Set(['medium', 'large']),
  large: new Set(['large']),
};

export function setupSizeFilter({ nodes, edges, container, onChange }) {
  const buttons = [...container.querySelectorAll('button[data-filter]')];

  function apply(mode) {
    const visible = VISIBLE[mode] || VISIBLE.all;
    for (const n of nodes) {
      n._hidden = !visible.has(n.sizeTier || 'small');
      n._el.classList.toggle('node-hidden', n._hidden);
    }
    for (const e of edges) {
      e._line.classList.toggle('edge-hidden', e.source._hidden || e.target._hidden);
    }
    for (const b of buttons) b.classList.toggle('active', b.dataset.filter === mode);
    onChange && onChange(nodes.filter((n) => !n._hidden).length);
  }

  for (const b of buttons) {
    b.addEventListener('click', () => apply(b.dataset.filter));
  }

  return { apply };
}
