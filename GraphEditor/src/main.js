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
import { setupInteractions } from './graph/interactions.js';
import { setupSizeFilter } from './graph/size-filter.js';
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
  const stats = document.getElementById('stats');
  const setStats = (shown) => {
    const base = `${graph.nodes.length} files · ${graph.edges.length} dependencies`;
    stats.textContent = shown < graph.nodes.length ? `${base} · ${shown} shown` : base;
  };
  setStats(graph.nodes.length);

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
  sim.on('tick', render); // drives live updates while dragging reheats the sim

  // Compute the initial layout synchronously: tick the simulation to settle
  // (no animation), then render once and fit. This produces a good static
  // layout instantly and is robust to background rAF throttling. The sim is
  // left stopped; dragging restarts it at low alpha (see interactions).
  sim.stop();
  const ticks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
  for (let i = 0; i < ticks; i++) sim.tick();
  render();
  // The viewport may report a zero/tentative size for the first frames (an
  // iframe/preview settles its dimensions late), which makes fit() clamp to a
  // tiny scale. So fit only when the viewport has a real size, and keep
  // re-fitting briefly until it settles — but never after the user has
  // panned/zoomed, so we don't yank the view out from under them.
  const tryFit = () => {
    if (zoom.userMoved()) return true;
    if (viewport.clientWidth > 0 && viewport.clientHeight > 0) { zoom.fit(graph.nodes); return true; }
    return false;
  };
  tryFit();
  let attempts = 0;
  const poll = setInterval(() => { if (tryFit() && ++attempts > 8) clearInterval(poll); }, 120);
  // Genuine later resizes (real browser): re-fit until the user takes over.
  new ResizeObserver(() => { if (!zoom.userMoved()) zoom.fit(graph.nodes); }).observe(viewport);

  setupInteractions({ nodes: graph.nodes, edges: graph.edges, sim, zoom, viewport, render });

  setupSizeFilter({
    nodes: graph.nodes,
    edges: graph.edges,
    container: document.getElementById('size-filter'),
    onChange: setStats,
  });
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

main().catch((e) => console.error('GraphEditor failed to start:', e));
