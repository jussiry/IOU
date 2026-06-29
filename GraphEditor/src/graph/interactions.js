/**
 * interactions.js — hover highlighting and node dragging for Overview mode.
 *
 * Hover: pointing at a node highlights its 1-hop dependency neighbourhood. The
 * hovered node and its neighbours get a thicker ring; connecting edges become
 * bold and are coloured by direction —
 *   - "depends on" (outgoing, this file → its imports)        → out colour
 *   - "depended on by" (incoming, importers → this file)      → in colour
 * Everything unrelated dims so the neighbourhood reads clearly.
 *
 * Drag: dragging a node moves it (pinning it where dropped) and gently reheats
 * the simulation so neighbours rearrange; dragging the background pans (handled
 * by d3-zoom, which is filtered to ignore pointer-downs on nodes). Screen-space
 * drag deltas are divided by the current zoom scale to stay in layout space, so
 * the node tracks the cursor at any zoom level. We use plain pointer events
 * (not d3-drag) so the gesture is fully under our control.
 */

export function setupInteractions({ nodes, edges, sim, zoom, viewport, render }) {
  // Adjacency: per node, the edges where it is the source (out) / target (in).
  const adj = new Map(nodes.map((n) => [n, { out: [], in: [] }]));
  for (const e of edges) {
    adj.get(e.source)?.out.push(e);
    adj.get(e.target)?.in.push(e);
  }

  // Floating, screen-space description card (readable regardless of zoom).
  const card = document.createElement('div');
  card.id = 'hover-card';
  card.innerHTML = `
    <div class="hc-header">
      <div class="hc-title"></div>
      <div class="hc-badges">
        <span class="hc-badge" title="exported functions">ƒ <b class="hc-fns">0</b></span>
        <span class="hc-badge" title="exported constants"># <b class="hc-consts">0</b></span>
        <span class="hc-badge hc-size" title="file size"><b class="hc-chars"></b></span>
      </div>
    </div>
    <div class="hc-meta"></div>
    <div class="hc-desc"></div>`;
  viewport.appendChild(card);

  function highlight(node) {
    viewport.classList.add('has-hover');
    node._el.classList.add('hl', 'hl-center');
    const { out, in: incoming } = adj.get(node);
    for (const e of out) {
      e._line.classList.add('edge-hl', 'edge-out');
      e._line.setAttribute('marker-end', 'url(#arrow-out)');
      e.target._el.classList.add('hl', 'hl-out');
    }
    for (const e of incoming) {
      e._line.classList.add('edge-hl', 'edge-in');
      e._line.setAttribute('marker-end', 'url(#arrow-in)');
      e.source._el.classList.add('hl', 'hl-in');
    }
    showCard(node);
  }

  function clear() {
    viewport.classList.remove('has-hover');
    for (const n of nodes) n._el.classList.remove('hl', 'hl-center', 'hl-out', 'hl-in');
    for (const e of edges) {
      e._line.classList.remove('edge-hl', 'edge-out', 'edge-in');
      e._line.setAttribute('marker-end', 'url(#arrow)');
    }
    card.classList.remove('show');
  }

  // Place the description card so it covers as few highlighted nodes as
  // possible. We search candidate positions at increasing distance from the
  // node, across several angles (ordered to prefer the side facing *away* from
  // the neighbour cluster), and take the first spot with no overlap — falling
  // back to the least-overlapping one. Searching outward means the card sits
  // close when there's room and drifts farther away only when it must.
  function formatChars(n) {
    if (!n) return '?';
    return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  }

  function showCard(node) {
    card.querySelector('.hc-title').textContent = node.name;
    card.querySelector('.hc-meta').textContent =
      [node.path, node.category].filter(Boolean).join('  ·  ');
    card.querySelector('.hc-desc').textContent = node.description || '(no description)';
    card.querySelector('.hc-fns').textContent = node.exports?.fns ?? '?';
    card.querySelector('.hc-consts').textContent = node.exports?.consts ?? '?';
    card.querySelector('.hc-chars').textContent = formatChars(node.chars);
    card.style.transform = 'none';
    card.classList.add('show'); // make it laid out so we can measure it

    const t = zoom.transform();
    const project = (m) => ({ x: t.x + m.x * t.k, y: t.y + m.y * t.k });
    const here = project(node);

    // Highlighted node rectangles (in viewport coords) to avoid covering.
    const vr = viewport.getBoundingClientRect();
    const obstacles = [...viewport.querySelectorAll('.node.hl')].map((el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - vr.left, t: r.top - vr.top, r: r.right - vr.left, b: r.bottom - vr.top };
    });

    // Preferred direction: away from the neighbour-cluster centroid.
    const { out, in: incoming } = adj.get(node);
    const neigh = [...out.map((e) => e.target), ...incoming.map((e) => e.source)];
    let baseAngle = 0;
    if (neigh.length) {
      let ax = 0, ay = 0;
      for (const m of neigh) { const p = project(m); ax += p.x; ay += p.y; }
      const dx = here.x - ax / neigh.length, dy = here.y - ay / neigh.length;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) baseAngle = Math.atan2(dy, dx);
    }

    const cw = card.offsetWidth, ch = card.offsetHeight;
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const overlap = (a, b) => {
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      return w > 0 && h > 0 ? w * h : 0;
    };
    // Angles spread out from the preferred direction; distances grow outward.
    const angleSpread = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
    let best = null;
    outer:
    for (let dist = 40; dist <= 700; dist += 40) {
      for (const da of angleSpread) {
        const a = baseAngle + (da * Math.PI) / 180;
        const cx = here.x + Math.cos(a) * dist;
        const cy = here.y + Math.sin(a) * dist;
        const left = Math.max(8, Math.min(cx - cw / 2, vw - cw - 8));
        const top = Math.max(8, Math.min(cy - ch / 2, vh - ch - 8));
        const rect = { l: left, t: top, r: left + cw, b: top + ch };
        let cost = 0;
        for (const o of obstacles) cost += overlap(rect, o);
        if (cost === 0) { best = { left, top }; break outer; }
        if (!best || cost < best.cost) best = { left, top, cost };
      }
    }

    card.style.left = `${best.left}px`;
    card.style.top = `${best.top}px`;
  }

  // --- Hover ---------------------------------------------------------------
  for (const n of nodes) {
    n._el.addEventListener('mouseenter', () => highlight(n));
    n._el.addEventListener('mouseleave', clear);
  }

  // --- Drag ----------------------------------------------------------------
  for (const n of nodes) {
    n._el.addEventListener('pointerdown', (event) => {
      if (event.button) return; // primary button only
      event.stopPropagation(); // don't let the background pan kick in
      const sx = event.clientX, sy = event.clientY, nx = n.x, ny = n.y;
      n._el.classList.add('dragging');
      n._el.setPointerCapture?.(event.pointerId);
      clear(); // drop hover highlight while dragging
      sim.alphaTarget(0.3).restart(); // gently reheat so neighbours rearrange

      const move = (e) => {
        const k = zoom.scale() || 1;
        n.fx = nx + (e.clientX - sx) / k;
        n.fy = ny + (e.clientY - sy) / k;
        n.x = n.fx;
        n.y = n.fy;
        render(); // immediate feedback even if rAF ticks are throttled
      };
      const up = () => {
        n._el.classList.remove('dragging');
        sim.alphaTarget(0); // cool down; fx/fy stay so the node is pinned where dropped
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
}
