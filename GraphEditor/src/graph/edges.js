/**
 * edges.js — renders directed dependency edges as SVG lines with arrowheads.
 *
 * One <line> per edge, source → target (the arrow points at the dependency:
 * "source depends on target"). After d3-force resolves each link's
 * `source`/`target` to node objects, `update()` (called every tick / on drag)
 * recomputes the endpoints, trimming each to the node's box boundary so lines
 * start/stop at the pill edge and the arrowhead sits just outside the target
 * node rather than hidden beneath it.
 *
 * Each line element is stored on its edge object (`edge._line`) so the
 * interactions layer can restyle individual edges on hover (direction-coloured
 * highlight). Overview's resting state keeps edges neutral with one arrow style.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const GAP = 4; // px of clearance between line end and node border

/** Point on `node`'s box boundary along the ray toward `from`. */
function boundaryPoint(node, from) {
  const dx = from.x - node.x;
  const dy = from.y - node.y;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const hw = node.w / 2 + GAP;
  const hh = node.h / 2 + GAP;
  const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: node.x + dx * t, y: node.y + dy * t };
}

export function renderEdges(group, edges) {
  for (const e of edges) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'edge');
    line.setAttribute('marker-end', 'url(#arrow)');
    group.appendChild(line);
    e._line = line;
  }

  return function update() {
    for (const e of edges) {
      const a = boundaryPoint(e.source, e.target); // start at source border
      const b = boundaryPoint(e.target, e.source); // end at target border
      e._line.setAttribute('x1', a.x);
      e._line.setAttribute('y1', a.y);
      e._line.setAttribute('x2', b.x);
      e._line.setAttribute('y2', b.y);
    }
  };
}
