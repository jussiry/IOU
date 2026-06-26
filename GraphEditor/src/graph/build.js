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
 * Node size in Overview is driven by name length (a small pill) nudged up by
 * how connected the file is, so hubs read as larger.
 */

const CHAR_W = 7.5;      // approx px per char at the overview font size
const PAD_X = 48;        // fixed overhead: symbol + gaps + left/right padding
const BASE_H = 26;       // pill height
const HUB_BOOST = 1.6;   // extra px of width per connection

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
    const degree = n.inDegree + n.outDegree;
    n.w = Math.round(n.name.length * CHAR_W + PAD_X + degree * HUB_BOOST);
    n.h = BASE_H;
  }

  return { root: raw.root, nodes, edges, byId };
}
