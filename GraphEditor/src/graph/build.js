/**
 * build.js — turns raw graph.json into the in-memory structures the renderer
 * and the d3-force simulation use.
 *
 * Responsibilities:
 *  - clone nodes (d3-force mutates them with x/y/vx/vy) and attach an estimated
 *    box size (w/h) used by the collision force and by node rendering;
 *  - clone edges into d3 links keyed by node id;
 *  - precompute each node's in/out degree (for sizing and, later, Focus mode).
 *
 * Node size in Overview is driven by file size (character count): bigger files
 * render as bigger pills. We attach a `sizeScale` (font multiplier) and a
 * coarse `sizeTier` (small/medium/large) used for the topbar size filter. The
 * pill's real pixel w/h is measured from the DOM in main.js once styled.
 *
 * We also attach a dependency `level` (see hierarchy.js) used by the simulation
 * to stack the graph vertically — entry points on top, leaf modules below.
 */

import { computeLevels } from './hierarchy.js';

const CHAR_W = 7.5;      // approx px per char at the overview font size
const PAD_X = 48;        // fixed overhead: symbol + gaps + left/right padding
const BASE_H = 26;       // pill height (initial estimate; remeasured in main.js)

// File size → visual scale. Square-root mapping so the pill *area* tracks file
// size without huge files dwarfing everything; clamped to a legible range.
const SIZE_MIN = 500;    // ~smallest file
const SIZE_MAX = 35000;  // ~largest file
const SCALE_MIN = 0.85;
const SCALE_MAX = 2.0;
const ROOT_MIN = Math.sqrt(SIZE_MIN);
const ROOT_SPAN = Math.sqrt(SIZE_MAX) - ROOT_MIN;

// Tier thresholds (chars) for the size filter.
const MEDIUM_MIN = 3000;
const LARGE_MIN = 8000;

function sizeScale(chars) {
  const r = (Math.sqrt(Math.max(chars || SIZE_MIN, SIZE_MIN)) - ROOT_MIN) / ROOT_SPAN;
  return SCALE_MIN + Math.max(0, Math.min(1, r)) * (SCALE_MAX - SCALE_MIN);
}

function sizeTier(chars) {
  if ((chars || 0) >= LARGE_MIN) return 'large';
  if ((chars || 0) >= MEDIUM_MIN) return 'medium';
  return 'small';
}

export function buildGraph(raw) {
  const nodes = raw.nodes.map((n) => ({ ...n }));
  const edges = raw.edges.map((e) => ({ source: e.source, target: e.target }));

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) { n.inDegree = 0; n.outDegree = 0; }
  for (const e of edges) {
    byId.get(e.source) && byId.get(e.source).outDegree++;
    byId.get(e.target) && byId.get(e.target).inDegree++;
  }

  for (const n of nodes) {
    n.sizeScale = sizeScale(n.chars);
    n.sizeTier = sizeTier(n.chars);
    n.w = Math.round((n.name.length * CHAR_W + PAD_X) * n.sizeScale);
    n.h = Math.round(BASE_H * n.sizeScale);
  }

  const maxLevel = computeLevels(nodes, edges, byId);

  return { root: raw.root, nodes, edges, byId, maxLevel };
}
