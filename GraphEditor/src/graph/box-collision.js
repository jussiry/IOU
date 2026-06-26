/**
 * box-collision.js — a custom d3-force that treats each node as a rectangle
 * (w × h) rather than a circle, and separates overlapping boxes along their
 * minimum-overlap axis.
 *
 * Why not d3's forceCollide: that force is circle-based (a single radius), so
 * for rectangular text cards it reserves a circumscribed circle and leaves
 * loose gaps around wide/tall nodes. Boxes pack tighter and render cleanly.
 *
 * Implementation is O(n²) per tick — fine for the hundreds-of-nodes target.
 * If profiling ever demands it, swap the inner loop for a quadtree broad-phase.
 */

export function boxCollision(padding = 8, { strength = 0.9, iterations = 2 } = {}) {
  let nodes;

  function resolve(strengthNow) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const aw = a.w / 2 + padding;
      const ah = a.h / 2 + padding;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = aw + b.w / 2 + padding - Math.abs(dx);
        const overlapY = ah + b.h / 2 + padding - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          // push apart along the axis of least overlap
          if (overlapX < overlapY) {
            const push = (dx < 0 ? -overlapX : overlapX) * strengthNow;
            a.x -= push / 2; b.x += push / 2;
          } else {
            const push = (dy < 0 ? -overlapY : overlapY) * strengthNow;
            a.y -= push / 2; b.y += push / 2;
          }
        }
      }
    }
  }

  function force(alpha) {
    // A couple of relaxation passes per tick settle dense clusters faster.
    const strengthNow = strength * Math.max(alpha, 0.3);
    for (let k = 0; k < iterations; k++) resolve(strengthNow);
  }

  force.initialize = (n) => { nodes = n; };
  return force;
}
