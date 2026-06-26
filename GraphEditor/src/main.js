/**
 * main.js — bootstraps the GraphEditor Overview.
 *
 * Flow: fetch graph.json → build in-memory graph → create the SVG edge layer
 * and HTML node layer → run the d3-force simulation → wire pan/zoom. Each
 * simulation tick repositions edges and nodes; the sim settles itself and then
 * stops ticking (d3 alphaMin), so it idles cheaply.
 *
 * This is the Overview milestone: whole graph, minimal name-only nodes, box
 * physics. Focus mode (click a node → neighborhood of rich cards) comes next.
 */

import { buildGraph } from './graph/build.js';
import { createSimulation } from './graph/simulation.js';
import { renderEdges } from './graph/edges.js';
import { createOverviewNode } from './ui/overview-node.js';
import { setupZoom } from './graph/zoom.js';
import { CATEGORIES, FALLBACK } from './graph/categories.js';

// Prefer the analyser output; fall back to the hand-written dummy.
const DATA_URLS = ['./data/graph.json', './data/graph.sample.json'];

async function loadGraph() {
  for (const url of DATA_URLS) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch { /* try next */ }
  }
  throw new Error('No graph data found (run `npm run analyse`).');
}

async function main() {
  const viewport = document.getElementById('viewport');
  const edgesGroup = document.getElementById('edges-group');
  const nodeLayer = document.getElementById('node-layer');
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;

  const raw = await loadGraph();
  const graph = buildGraph(raw);

  renderLegend(graph);
  document.getElementById('stats').textContent =
    `${graph.nodes.length} files · ${graph.edges.length} dependencies`;

  const updateEdges = renderEdges(edgesGroup, graph.edges);

  const nodeUpdaters = graph.nodes.map((node) => {
    const { el, update } = createOverviewNode(node, {
      onClick: (n) => console.log('node clicked (Focus mode TBD):', n.id),
    });
    nodeLayer.appendChild(el);
    return { node, el, update };
  });

  // Measure rendered pills so the box-collision force matches the real DOM.
  for (const { node, el } of nodeUpdaters) {
    node.w = el.offsetWidth;
    node.h = el.offsetHeight;
  }

  const zoom = setupZoom({ viewport, edgesGroup, nodeLayer });

  const render = () => {
    updateEdges();
    for (const { update } of nodeUpdaters) update();
  };

  const sim = createSimulation({ nodes: graph.nodes, edges: graph.edges, width, height });

  // Compute the initial layout synchronously: tick the simulation to settle
  // (no animation), then render once and fit. This produces a good static
  // layout instantly and is robust to background rAF throttling. The sim is
  // left stopped; drag/relayout will restart it at low alpha in a later step.
  sim.stop();
  const ticks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  for (let i = 0; i < ticks; i++) sim.tick();
  render();
  zoom.fit(graph.nodes);
}

function renderLegend(graph) {
  const used = new Set(graph.nodes.map((n) => n.category).filter(Boolean));
  const legend = document.getElementById('legend');
  const entries = Object.entries(CATEGORIES).filter(([key]) => used.has(key));
  if (used.size < graph.nodes.length) entries.push(['(uncategorised)', FALLBACK]);

  legend.innerHTML = '';
  for (const [key, { color, symbol, label }] of entries) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML =
      `<span class="legend-swatch" style="color:${color}">${symbol}</span>` +
      `${label || key}`;
    legend.appendChild(item);
  }
}

main();
