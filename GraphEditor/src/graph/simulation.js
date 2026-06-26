/**
 * simulation.js — sets up the d3-force layout for Overview mode.
 *
 * Forces:
 *  - link    : edges act as springs, pulling connected files together;
 *  - charge  : nodes repel so the graph spreads out;
 *  - center  : keeps the whole graph centred in the viewport;
 *  - collide : custom rectangular (box) collision so nodes don't overlap.
 *
 * Connectedness therefore determines proximity — the core requirement.
 * The caller settles the layout synchronously (stop the sim, then `tick()` in a
 * loop) and renders once — a good static layout instantly, independent of
 * requestAnimationFrame throttling. Drag/relayout can later restart it.
 */

import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force';
import { boxCollision } from './box-collision.js';

export function createSimulation({ nodes, edges, width, height }) {
  return forceSimulation(nodes)
    .force('link', forceLink(edges).id((d) => d.id).distance(70).strength(0.15))
    .force('charge', forceManyBody().strength(-650).distanceMax(900))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collide', boxCollision(12, { strength: 1, iterations: 3 }));
}
