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

  return {
    behavior,
    reset: () => select(viewport).call(behavior.transform, zoomIdentity),
  };
}
