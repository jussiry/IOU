/**
 * zoom.js — wires d3-zoom to pan/zoom the graph, keeping the two render layers
 * in sync.
 *
 * The edge layer is an <svg> with an inner <g>; the node layer is an HTML div.
 * A single d3-zoom on the viewport drives both: the <g> gets an SVG transform
 * attribute and the node div gets the equivalent CSS transform, so lines and
 * node cards always share one coordinate space.
 *
 * Later, semantic zoom will read the current scale `k` to pick a detail tier.
 */

import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';

export function setupZoom({ viewport, edgesGroup, nodeLayer, onScale }) {
  const behavior = d3zoom()
    .scaleExtent([0.15, 4])
    .on('zoom', (event) => {
      const { x, y, k } = event.transform;
      edgesGroup.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
      nodeLayer.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
      onScale && onScale(k);
    });

  select(viewport).call(behavior);

  // Fit all nodes into the viewport with padding (called once the sim settles).
  function fit(nodes, padding = 40) {
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.w / 2);
      minY = Math.min(minY, n.y - n.h / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      maxY = Math.max(maxY, n.y + n.h / 2);
    }
    const gw = maxX - minX;
    const gh = maxY - minY;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const k = Math.max(0.15, Math.min(4, 0.95 * Math.min((vw - padding) / gw, (vh - padding) / gh)));
    const tx = (vw - k * (minX + maxX)) / 2;
    const ty = (vh - k * (minY + maxY)) / 2;
    select(viewport).call(behavior.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  return {
    behavior,
    fit,
    reset: () => select(viewport).call(behavior.transform, zoomIdentity),
  };
}
