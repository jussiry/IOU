/**
 * edges.js — renders dependency edges as SVG lines in the back layer.
 *
 * One <line> per edge. After d3-force resolves each link's `source`/`target`
 * to node objects, `update()` (called every tick) copies their x/y into the
 * line endpoints. Direction styling (arrows, depends-on vs depended-on-by) is
 * deferred to Focus mode; Overview keeps edges thin and neutral.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderEdges(group, edges) {
  const lines = edges.map((e) => {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'edge');
    group.appendChild(line);
    return { e, line };
  });

  return function update() {
    for (const { e, line } of lines) {
      line.setAttribute('x1', e.source.x);
      line.setAttribute('y1', e.source.y);
      line.setAttribute('x2', e.target.x);
      line.setAttribute('y2', e.target.y);
    }
  };
}
