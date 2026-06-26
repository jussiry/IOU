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
 * Callers pass an `onTick` to reposition DOM each frame, and should `stop()`
 * the simulation when idle (it settles on its own via alphaMin).
 */

import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force';
import { boxCollision } from './box-collision.js';

export function createSimulation({ nodes, edges, width, height, onTick }) {
  return forceSimulation(nodes)
    .force('link', forceLink(edges).id((d) => d.id).distance(110).strength(0.4))
    .force('charge', forceManyBody().strength(-340))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collide', boxCollision(8))
    .on('tick', onTick);
}
