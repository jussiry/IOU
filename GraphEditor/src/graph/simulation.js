/**
 * simulation.js — sets up the d3-force layout for Overview mode.
 *
 * Forces:
 *  - link    : edges act as springs, pulling connected files together;
 *  - charge  : nodes repel so the graph spreads out — repulsion scales with a
 *              node's size so bigger files push their neighbours further away;
 *  - center  : keeps the whole graph centred in the viewport;
 *  - collide : custom rectangular (box) collision so nodes don't overlap.
 *
 * Connectedness therefore determines proximity — the core requirement.
 * The caller settles the layout synchronously (stop the sim, then `tick()` in a
 * loop) and renders once — a good static layout instantly, independent of
 * requestAnimationFrame throttling. Drag/relayout can later restart it.
 */

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceY } from 'd3-force';
import { boxCollision } from './box-collision.js';

// ── Tuning knobs ─────────────────────────────────────────────────────────────
// How strongly nodes repel each other. More negative = more spread (less
// clumping); less negative = tighter. Scaled per node by its sizeScale, so big
// files push harder. This is the main value to play with for overall spacing.
const CHARGE_STRENGTH = -750;

// Vertical hierarchy: each node is pulled toward a row determined by its
// dependency level (see hierarchy.js) — entry points / consumers on top,
// foundational modules at the bottom. LAYER_GAP is the target px between
// adjacent levels; HIERARCHY_STRENGTH is how firmly nodes snap to their row
// (0 = off / free layout, ~0.3 = strong stratification).
const LAYER_GAP = 130;
const HIERARCHY_STRENGTH = 0.22;
// ─────────────────────────────────────────────────────────────────────────────

export function createSimulation({ nodes, edges, width, height, maxLevel = 0 }) {
  // Target Y per node from its level, centred on 0 (forceCenter re-centres the
  // whole stack in the viewport). Higher level → higher up (smaller Y).
  const targetY = (d) => (maxLevel / 2 - (d.level || 0)) * LAYER_GAP;

  return forceSimulation(nodes)
    .force('link', forceLink(edges).id((d) => d.id).distance(70).strength(0.15))
    .force('charge', forceManyBody().strength((d) => CHARGE_STRENGTH * (d.sizeScale || 1)).distanceMax(1200))
    .force('center', forceCenter(width / 2, height / 2))
    .force('hierarchy', forceY(targetY).strength(HIERARCHY_STRENGTH))
    .force('collide', boxCollision(12, { strength: 1, iterations: 3 }));
}
