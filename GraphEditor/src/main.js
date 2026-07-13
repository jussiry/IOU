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
import { setupFilters, UNCATEGORISED } from './graph/filters.js';
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
  setupCategoryDropdown();
  const stats = document.getElementById('stats');
  reserveStatsWidth(stats, graph);
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

  const sim = createSimulation({ nodes: graph.nodes, edges: graph.edges, width, height, maxLevel: graph.maxLevel });
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

  setupFilters({
    nodes: graph.nodes,
    edges: graph.edges,
    sizeContainer: document.getElementById('size-filter'),
    legendContainer: document.getElementById('legend'),
    onChange: setStats,
  });
}

function renderLegend(graph) {
  const used = new Set(graph.nodes.map((n) => n.category).filter(Boolean));
  const legend = document.getElementById('legend');
  const entries = Object.entries(CATEGORIES).filter(([key]) => used.has(key));
  if (used.size < graph.nodes.length) entries.push([UNCATEGORISED, FALLBACK]);

  legend.innerHTML = '';
  // Toggle-all button comes first in the legend row.
  const toggleAll = document.createElement('span');
  toggleAll.id = 'legend-toggle-all';
  toggleAll.className = 'legend-toggle-all';
  toggleAll.textContent = '◎';
  toggleAll.title = 'Hide all categories';
  toggleAll.setAttribute('role', 'button');
  legend.appendChild(toggleAll);

  for (const [key, { color, symbol, label }] of entries) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.dataset.category = key; // makes it a toggle (see filters.js)
    item.setAttribute('role', 'button');
    item.title = `Toggle ${label || key}`;
    item.innerHTML =
      `<span class="legend-swatch" style="color:${color}">${symbol}</span>` +
      `${label || key}`;
    legend.appendChild(item);
  }
}

// Reserves a fixed width for #stats sized to the longest possible rendering
// (every file counted as "shown"). Category toggles change the shown count,
// but the element's own size then never changes, so it can't shift the
// buttons that sit after it in the header.
function reserveStatsWidth(stats, graph) {
  const probe = `${graph.nodes.length} files · ${graph.edges.length} dependencies · ${graph.nodes.length} shown`;
  stats.textContent = probe;
  stats.style.minWidth = `${stats.offsetWidth}px`;
}

// The category legend shows inline when it fits next to the other header
// controls; otherwise it collapses into a fixed-size "Categories" button that
// opens the same toggle list as a popover. Re-checked on resize against
// #topbar's own overflow, so it reacts to both window width and category count.
function setupCategoryDropdown() {
  const wrap = document.getElementById('categories');
  const topbar = document.getElementById('topbar');
  const toggle = document.getElementById('categories-toggle');

  const updateLayout = () => {
    wrap.classList.remove('collapsed'); // lay out inline first to measure it
    const overflowing = topbar.scrollWidth > topbar.clientWidth + 1;
    wrap.classList.toggle('collapsed', overflowing);
    if (!overflowing) wrap.classList.remove('open');
  };

  toggle.addEventListener('click', () => wrap.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (wrap.classList.contains('open') && !wrap.contains(e.target)) wrap.classList.remove('open');
  });

  updateLayout();
  new ResizeObserver(updateLayout).observe(topbar);
}

main().catch((e) => console.error('GraphEditor failed to start:', e));
