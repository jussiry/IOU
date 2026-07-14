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
import { CATEGORIES, FALLBACK, legendItemEl } from './graph/categories.js';

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
  const categoryDropdown = setupCategoryDropdown();
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
  // What the automatic fit frames. Normally the whole graph, but the embed API
  // narrows it to a custom subset (see setupEmbedBridge) so the graph zooms in
  // on the documented files — and *stays* framed on them through the graph
  // column's open/resize, instead of the ResizeObserver below snapping back to
  // the whole graph and clobbering that zoom.
  let fitTargetNodes = () => graph.nodes;
  const setFitTarget = (fn) => { fitTargetNodes = fn; };

  // The viewport may report a zero/tentative size for the first frames (an
  // iframe/preview settles its dimensions late), which makes fit() clamp to a
  // tiny scale. So fit only when the viewport has a real size, and keep
  // re-fitting briefly until it settles — but never after the user has
  // panned/zoomed, so we don't yank the view out from under them.
  const tryFit = () => {
    if (zoom.userMoved()) return true;
    if (viewport.clientWidth > 0 && viewport.clientHeight > 0) { zoom.fit(fitTargetNodes()); return true; }
    return false;
  };
  tryFit();
  let attempts = 0;
  const poll = setInterval(() => { if (tryFit() && ++attempts > 8) clearInterval(poll); }, 120);
  // Genuine later resizes (real browser): re-fit until the user takes over.
  new ResizeObserver(() => { if (!zoom.userMoved()) zoom.fit(fitTargetNodes()); }).observe(viewport);

  setupInteractions({ nodes: graph.nodes, edges: graph.edges, sim, zoom, viewport, render });

  const filters = setupFilters({
    nodes: graph.nodes,
    edges: graph.edges,
    sizeContainer: document.getElementById('size-filter'),
    legendContainer: document.getElementById('legend'),
    onChange: setStats,
    // The "custom" entry can appear/disappear at runtime (via the embed API),
    // which changes how much room the legend needs — recheck the collapse
    // threshold whenever that happens.
    onLegendChange: categoryDropdown.updateLayout,
  });

  setupEmbedBridge({ graph, zoom, filters, setFitTarget });
  setupGitModified(filters);
}

// Populate the "modified" category from the dev server's `git status` (see
// scripts/serve.mjs → /api/git-modified). Refreshed when the window regains
// focus, so switching back from an editor reflects new edits. Fails silently
// when there's no server/git (e.g. opened from disk), leaving the category off.
function setupGitModified(filters) {
  let inFlight = false;
  const refresh = () => {
    if (inFlight) return;
    inFlight = true;
    fetch('./api/git-modified')
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d) => filters.setModified(d.files || []))
      .catch(() => { /* no server / not a git repo — leave it off */ })
      .finally(() => { inFlight = false; });
  };
  refresh();
  window.addEventListener('focus', refresh);
}

// Embed bridge — lets a host page (e.g. the Design site's graph column) drive
// this standalone app through an iframe + postMessage API, without any shared
// code. Protocol:
//   host → editor : { type: 'showNodes', ids: [...], name?: string } | { type: 'clearFilter' }
//   editor → host : { source: 'graph-editor', type: 'ready' | 'close' }
// `showNodes` populates the "custom" category (see filters.js `applyCustom`)
// with the given node ids, labelled `name` if given (defaults to "Custom").
// `?embed=1` reveals the close button; `?nodes=a,b&name=...` applies an initial
// custom set on load so the first paint is already filtered (no round-trip
// needed).
function setupEmbedBridge({ graph, zoom, filters, setFitTarget }) {
  const params = new URLSearchParams(location.search);
  const embedded = window.parent && window.parent !== window;
  const post = (msg) => embedded && window.parent.postMessage(msg, '*');

  // Applying a custom set zooms in to frame exactly those files, and locks the
  // auto-fit onto them (captured here, so later legend toggles don't change
  // what's framed) so the column's open/resize keeps them in view. This tight
  // zoom happens only on this API call — never on ordinary category clicks.
  const showNodes = (ids, name) => {
    filters.applyCustom(ids || [], name);
    const framed = graph.nodes.filter((n) => !n._hidden);
    const target = framed.length ? framed : graph.nodes;
    setFitTarget(() => target);
    zoom.fit(target);
  };
  const clearFilter = () => {
    filters.clearCustom();
    setFitTarget(() => graph.nodes);
    zoom.fit(graph.nodes);
  };

  if (params.has('embed')) document.body.classList.add('embed');
  const closeBtn = document.getElementById('embed-close');
  if (closeBtn && params.has('embed')) {
    closeBtn.hidden = false;
    closeBtn.addEventListener('click', () => post({ source: 'graph-editor', type: 'close' }));
  }

  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'showNodes') showNodes(d.ids, d.name);
    else if (d.type === 'clearFilter') clearFilter();
  });

  // Initial custom set straight from the URL, then announce readiness so a host
  // that prefers the message API can (re)send once the iframe is live.
  const initial = params.get('nodes');
  if (initial) showNodes(initial.split(/[\s,]+/).filter(Boolean), params.get('name'));
  post({ source: 'graph-editor', type: 'ready' });
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

  for (const [key, style] of entries) {
    legend.appendChild(legendItemEl(key, style)); // dataset.category makes it a toggle (see filters.js)
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
  return { updateLayout };
}

main().catch((e) => console.error('GraphEditor failed to start:', e));
