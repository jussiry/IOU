/**
 * hierarchy.js — assigns each node a dependency "level" so the layout can stack
 * the codebase vertically: consumers / entry points near the top, foundational
 * modules that many things depend on near the bottom.
 *
 * `level` = the length of the longest chain of "depends on" edges starting at a
 * node — i.e. its height above the leaves. A module that imports nothing is
 * level 0 (a leaf, drawn at the bottom); an entry point sitting atop a deep
 * import chain gets the highest level (drawn at the top). This is longest-path
 * layering, the ranking step of Sugiyama-style hierarchical layout.
 *
 * Real dependency graphs have cycles, which have no well-defined longest path.
 * We handle them with a DFS that ignores back-edges (edges pointing at a node
 * still on the recursion stack), so a strongly-connected clump collapses onto
 * roughly one level instead of looping forever. The result is only a *hint*:
 * the simulation nudges each node toward its level with a vertical force while
 * links and charge still shape the horizontal arrangement.
 *
 * Edge convention: `source` depends on `target` (source imports target), so the
 * source sits above the target.
 */

export function computeLevels(nodes, edges, byId) {
  // out[u] = the nodes u depends on (its imports).
  const out = new Map(nodes.map((n) => [n, []]));
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (s && t && s !== t) out.get(s).push(t);
  }

  const level = new Map();
  const state = new Map(); // unset = unvisited, 1 = on the DFS stack, 2 = done

  function visit(u) {
    state.set(u, 1);
    let best = 0;
    for (const v of out.get(u)) {
      if (state.get(v) === 1) continue;       // back-edge → part of a cycle, skip
      if (state.get(v) !== 2) visit(v);
      best = Math.max(best, level.get(v) + 1);
    }
    level.set(u, best);
    state.set(u, 2);
  }

  for (const n of nodes) if (state.get(n) !== 2) visit(n);

  let max = 0;
  for (const n of nodes) {
    n.level = level.get(n) || 0;
    if (n.level > max) max = n.level;
  }
  return max;
}
