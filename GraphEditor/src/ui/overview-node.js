/**
 * overview-node.js — renders a node in Overview mode: a compact pill showing a
 * category symbol and the file name, coloured by category.
 *
 * Deliberately minimal — Overview shows the whole graph, so each node must be
 * cheap DOM and legible at a glance. The rich, editable box card used in Focus
 * mode lives in node-card.js (later milestone).
 *
 * Returns the element and an `update()` that positions it from the node's
 * simulation coordinates each tick. Nodes are centred on (x, y).
 */

import { styleFor } from '../graph/categories.js';

export function createOverviewNode(node, { onClick } = {}) {
  const { color, symbol } = styleFor(node);

  const el = document.createElement('div');
  el.className = 'node';
  el.style.setProperty('--cat-color', color);
  // Bigger files → bigger pills. Scaling the font scales the whole pill (its
  // padding/radius are em-based in CSS); width/height are then measured in
  // main.js after append so the collision force matches exactly. The tier
  // drives the topbar size filter.
  el.style.fontSize = `${(12 * (node.sizeScale || 1)).toFixed(2)}px`;
  el.dataset.tier = node.sizeTier || 'small';

  const sym = document.createElement('span');
  sym.className = 'node-symbol';
  sym.textContent = symbol;

  const name = document.createElement('span');
  name.className = 'node-name';
  name.textContent = node.name;

  el.append(sym, name);
  if (onClick) el.addEventListener('click', () => onClick(node));

  node._el = el;
  const update = () => {
    el.style.transform = `translate(${node.x}px, ${node.y}px) translate(-50%, -50%)`;
  };

  return { el, update };
}
