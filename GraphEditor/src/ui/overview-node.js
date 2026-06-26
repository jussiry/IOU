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
  el.title = node.path;
  // Width/height come from the rendered box (measured in main.js after append),
  // so the pill sizes to its content and the collision force matches exactly.

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
