# GraphEditor — Code Dependency Graph Visualiser

A standalone HTML/JS app that analyses a codebase and renders it as an
interactive dependency graph. Each **file is a node**; each **import/require
relationship is an edge**. The goal is to make the shape of a codebase legible
at a glance: what depends on what, which files are hubs, and what a given file
actually does.

> Currently lives inside the IOU repo for convenience, but is designed to be
> extracted into its own repository. It has its own `package.json` and no
> dependency on IOU's code.

---

## Prior art (web research, June 2026)

The core concept — browsing code by **dependency structure** rather than the
file tree — is proven, but our specific angle (editable, file-level,
description-comment nodes) is largely unexplored.

**Closest concept match — [Sourcetrail](https://github.com/CoatiSoftware/Sourcetrail)**
(FOSS, discontinued 2021). Select a symbol and the graph "focuses on the
currently selected symbol and directly shows all incoming and outgoing
dependencies" — essentially our **Focus mode**, at *symbol* granularity. It
proved the graph-as-navigation model. Its abandonment is an opportunity. Study
its UX.

**Closest pipeline match — [CodeAtlas](https://github.com/Picrew/CodeAtlas)**
(open source). Turns a repo into a self-contained `codeatlas.html` interactive
**file** dependency graph plus `module-map.json` + `summary.md` — almost
exactly our "Node analyser → JSON → HTML viewer" pipeline.

**Adjacent (read-only viewers / onboarding maps):**
- [CodeSee](https://www.codesee.io/) — code maps of services/dirs/file deps,
  upstream+downstream, onboarding focus; "beyond a simple directory tree."
- [GitKraken Codemaps](https://www.gitkraken.com/features/code-dependency-mapping),
  NDepend (dependency matrix + graph), Emerge (browser-based, multi-language).
- A shared [Claude Code D3.js prompt](https://gist.github.com/aessam/963beecba29660a532b11f03b27e1b92)
  generates dependency graphs with **3 zoom levels** (system / module / full)
  — independent convergence on our semantic-zoom idea.

**What's novel here** (no tool found combining these):
1. **Nodes whose body is the human-written leading description comment** — the
   author's prose as first-class node content, not just extracted structure.
2. **Editable nodes / future in-node HTML editor** — prior art is almost all
   read-only viewers. The graph as an *editing workspace* is the differentiator.
3. Overview(circle) ↔ Focus(box neighborhood) as the primary navigation, like
   Sourcetrail but at file granularity with rich editable cards.

---

## Vision & context

This tool is aimed at **codebases written mostly by AI**, to give humans easier
access into them. The file's leading description comment — authored by the AI —
is the human-readable handle on each file, and the dependency graph is how you
navigate between them.

- **Now (v1):** read-only. Analyse a codebase, render description comments as
  nodes, browse by dependency.
- **Later:** an **iterative human↔AI loop**. AI writes a file's description
  comment → the user edits the comment as an *instruction* for change → AI
  modifies the code accordingly → AI rewrites the description comment to match.
  The graph becomes the editing surface for this loop. (Future — not v1.)

This is why nodes are editable DOM and why category/metadata lives *in the
comment*: the comment is the contract between human and AI.

---

## What each node shows

- **The file's purpose** — the description comment at the top of each file
  (the same convention IOU uses: a few paragraphs describing the module at the
  start of every JS file). This becomes the node's body text.
- **Outgoing edges** — files this node depends on (its imports).
- **Incoming edges** — files that depend on this node (its dependents).
- **Visual cues** — colour, icon/symbol, size, or badges encode file kind
  (UI module, model, util, test, entry point, etc.), so the type of a file is
  readable without reading the text.

## Core requirements

1. **Automatic layout is the priority.** With potentially hundreds of nodes of
   varying size and varying connection count, the initial arrangement must be
   computed by a good force-directed / layout algorithm. Connectedness drives
   proximity: heavily-linked files sit near each other; clusters emerge
   naturally.
2. **Varying node sizes.** Node dimensions depend on their text content and
   importance, so the layout engine must avoid overlaps between unequal boxes.
3. **Draggable nodes.** Users can manually nudge nodes; the layout is a
   starting point, not a cage.
4. **Visually editable nodes.** Colours, symbols, and other glyphs can be
   attached to convey file kind or user annotations. Node content is real,
   editable HTML — starting with simple text, with room to grow into a full
   in-node HTML editor later. Changing a node's content must be easy.
5. **Semantic zoom (level-of-detail).** Node content adapts to zoom level —
   minimal when zoomed out, progressively richer when zoomed in. See
   **[Zoom modes](#zoom-modes-overview-vs-focus)** for the concrete two-mode
   design.
6. **Scale.** Must stay usable for a whole codebase (hundreds of files,
   thousands of edges).

---

## Library choice

**Selected: [D3](https://d3js.org/) (modular `d3-*` packages) with HTML-`div`
nodes.**

The deciding factors are **editable HTML node content**, **easy content
swapping**, and **semantic zoom** (see below) — all of which favour nodes that
are *real DOM elements* rather than canvas-rendered overlays.

Why D3:

- **Nodes are live DOM.** Each node is an absolutely-positioned `<div>` (or
  `<foreignObject>`) synced to the zoom/pan transform. Content is plain HTML we
  fully own, so "change the content easily" and the future "full HTML editor
  inside a node" are natural — it's just editing a div. (Cytoscape renders to
  canvas and can only *overlay* HTML, which is awkward for in-node editing.)
- **Connection-driven auto-layout** via `d3-force`: `forceLink` (edges as
  springs), `forceManyBody` (repulsion), `forceCenter`. This satisfies the
  original priority — connectedness determines proximity.
- **Modular** — import only `d3-selection`, `d3-force`, `d3-zoom`, `d3-drag`
  (~50–70 KB), plus `d3-hierarchy` *only if/when* we add grouping. We never
  ship the full ~270 KB `d3` bundle.
- **Zero framework**, **drag/zoom/pan** via `d3-drag` / `d3-zoom`, and full
  control over rendering and interaction.

### Overlap removal — nodes are boxes, not circles

D3's built-in `forceCollide` is **circle-based**: it treats each node as a
circle of a given `radius` and only prevents circle–circle overlap. Since our
nodes are **rectangular text cards of varying aspect ratio**, a circle is the
wrong model — using `forceCollide` with the box's circumscribed-circle radius
would reserve a circle big enough to hold the box and leave loose, wasteful
gaps around wide/tall nodes.

Instead we use a **custom rectangular (AABB) collision force**: each node is a
`width × height` box, and overlapping boxes are pushed apart along their
minimum-overlap axis. This packs tightly and renders cleanly. It's small
(~30 lines) and is the standard approach when node shape matters. (This is one
thing `fcose` does out of the box for non-uniform nodes — in D3 we implement
it, in exchange for DOM-native, editable nodes.)

Other trade-off: D3 has **no built-in compound-node primitive**. For grouping
we'd draw **convex-hull boundaries** (`d3.polygonHull`) around clusters and add
a clustering force, or use `d3-hierarchy` (`pack`/`treemap`) when grouping is
strictly by folder/module.

### Alternatives considered

| Library | Verdict |
|---|---|
| **Cytoscape.js + `fcose`** | Documented fallback. Wins on **compound nodes** (true container nesting) and the most polished overlap-removal layout for varying-size nodes. Loses on node content: canvas-rendered, HTML only as an overlay → awkward in-node editing. Revisit if folder-as-container grouping becomes central. |
| **AntV G6** | Many layouts + rich native nodes, but bigger API churn and content still less DOM-native than D3. |
| **React Flow / Svelte Flow** | Best HTML-node editing UX, but weak auto-layout (needs ELK/dagre add-on) and requires a framework. |
| **Sigma.js / Cosmograph** | Excellent for 10k+ nodes via WebGL, but weak at text-rich, editable nodes. Overkill here. |

### Compound nodes / grouping in D3

Cytoscape's compound nodes have no direct D3 equivalent, but the effect is
reproducible:
- **Hierarchical grouping** (by folder/module): `d3-hierarchy` `pack` or
  `treemap` gives true nesting.
- **Force-layout grouping**: draw a convex hull around each cluster's members
  and add an attraction force so a group's nodes stay together.

---

## Zoom modes (overview vs focus)

Two distinct viewing modes, each with its own scope, node visual, and physics.

### Mode A — Overview (bird's-eye)

- **Scope:** the whole graph — all nodes and all edges.
- **Node visual:** minimal — a small pill/circle showing the **file name only**,
  coloured/iconed by file kind. Lightweight DOM (or canvas/SVG) so hundreds of
  nodes stay smooth.
- **Edges:** thin lines, direction de-emphasised; the point here is overall
  shape and clusters.
- **Goal:** see the structure of the whole codebase at a glance — hubs,
  clusters, isolated files.
- **Enter Focus:** click (or zoom past a threshold onto) a node.

### Mode B — Focus (neighborhood)

- **Scope:** the focused node **+ its 1-hop neighbors only**, split into:
  - **Depends on** — files this node requires (outgoing).
  - **Depended on by** — files that require this node (incoming).
- **Node visual:** rich text **boxes** — title + description + badges. Focused
  node centered and largest; neighbors smaller boxes around it.
- **Edges:** directional arrows that clearly separate the two groups (e.g.
  dependencies on one side, dependents on the other, or colour-coded).
- **Re-focus:** click a neighbor to recenter the neighborhood on it.
- **Exit:** Esc / back button returns to Overview, restoring prior pan/zoom.

### Transition

A node morphs **circle → box** as you enter Focus; content cross-fades from
name-only to the full card; non-neighbor nodes fade out. Reverse on exit.
Positions animate rather than jumping.

### Physics per mode — and a performance note

The original idea was: circle physics in Overview, box physics in Focus, on the
assumption that box physics for hundreds of nodes would lag. **It won't** — with
a quadtree, both circle and box collision run ~O(n log n), and a few hundred
nodes settle at 60fps either way. The real cost at scale is the **DOM**:
hundreds of rich HTML node cards being re-positioned every tick.

Therefore:
- **Start with box physics in both modes.** Physics is not the bottleneck.
- The Overview/Focus split is justified by **DOM cost + legibility**: Overview
  renders *little* per node and Focus renders rich boxes for only a handful of
  neighbors — so the expensive rich-card DOM only ever exists for a few nodes.
- Settle the simulation (`alphaMin`) and stop ticking when idle; re-run only on
  interaction.
- **Optimization knobs, only if Overview feels heavy** (in order): render
  overview nodes as canvas/SVG circles instead of divs; then, if still heavy,
  switch Overview to the cheaper circle-collision force.

---

## Planned architecture

```
GraphEditor/
├── package.json
├── README.md            ← this file (living plan)
├── index.html           ← app shell + graph container (SVG/canvas + HTML node layer)
├── src/
│   ├── main.js          ← bootstraps the app, wires analyser → graph
│   ├── analyser/        ← codebase analysis (file discovery, parsing)
│   │   ├── scan.js      ← walk a directory, collect source files
│   │   ├── imports.js   ← extract import/require dependencies per file
│   │   └── describe.js  ← pull the leading description comment per file
│   ├── graph/
│   │   ├── build.js     ← turn analysis output into graph nodes/edges
│   │   ├── simulation.js ← d3-force setup (link/charge/center + custom box-collision force)
│   │   ├── modes.js     ← Overview ↔ Focus state; neighbor selection; transitions
│   │   ├── zoom.js      ← d3-zoom + transform sync; detail tier per zoom
│   │   ├── edges.js     ← edge rendering (SVG lines/arrows) under the node layer
│   │   └── interactions.js ← d3-drag, hover highlight, click-to-focus dependency cone
│   └── ui/
│       ├── overview-node.js ← minimal pill/circle (name + kind)
│       └── node-card.js  ← rich Focus-mode box card (title, description, badges; editable)
└── styles.css
```

Rendering model: edges as SVG (or canvas) in a back layer; **nodes as
absolutely-positioned HTML `<div>`s** in a front layer. Both layers share the
`d3-zoom` transform so they pan/zoom together while node content stays
editable DOM.

### Pipeline

1. **Scan** — discover source files (configurable root + glob).
2. **Analyse** — for each file extract (a) its dependency edges from
   `import`/`require` statements, resolving to in-project files, and (b) the
   leading description comment, including any `@category` tag (read verbatim,
   not inferred).
3. **Build** — produce `nodes` (id, name, path, category, description, loc) and
   `edges` (source → target) per the [`graph.json` schema](#graphjson-schema).
4. **Layout** — run the `d3-force` simulation; connected files cluster, and a
   custom rectangular collision force keeps varying-size boxes apart.
5. **Render** — HTML node cards styled by file kind (colours/symbols), edges in
   the back layer. Node content renders at the current semantic-zoom detail
   tier.
6. **Interact** — drag to rearrange; zoom changes detail tier; click a node to
   highlight its dependency cone (ancestors + descendants); filter by kind.

### Decisions made

- **Analysis runtime.** A **Node analyser → `graph.json`** step. The UI loads
  the JSON. v1 can start against a **hand-written dummy `graph.json`** that uses
  the real schema, so the UI can be built before the analyser exists. Browser
  folder-picking is a possible later enhancement.
- **Categories come from the comment, not inference.** The analyser does **not**
  try to classify files. Each file declares its own category in its leading
  description comment (written by the AI that wrote the file, editable by the
  user). The visualiser just reads it and maps it to a colour/symbol. Unknown
  or missing categories get a neutral fallback. See *Categories & colours*.
- **Separate graphs are separate.** Backend / tests / client app are already
  disjoint dependency graphs and don't need to be shown together. Selecting
  which graph (or folder root) to view is a top-level choice. *Possible future:*
  bridge client↔backend by mapping API endpoints to handlers — but only if a
  clean mapping exists; not v1.

### Still open

- **Language scope.** Start with JS/TS import resolution; structure the
  analyser so other languages can be added.
- **Starter category vocabulary** — proposed below; expected to evolve once we
  see real codebases.

---

## Categories & colours

A file's category is declared **inside its leading description comment** via a
simple tag the analyser reads verbatim:

```js
/**
 * mesh.js — maintains the WebRTC peer mesh: tracks connected peers,
 * handles reconnection, and routes signalling messages.
 *
 * @category network
 */
```

The visualiser maps the tag string to a colour + symbol. This keeps
classification out of the analyser (no fragile heuristics) and in the hands of
whoever writes the comment (AI, then user).

**Starter palette** (a *suggested* vocabulary — categories are free-form
strings; unknown values fall back to neutral grey):

| Category   | Meaning                                   | Colour     | Symbol |
|------------|-------------------------------------------|------------|--------|
| `ui`       | UI components / views / pages             | `#4F86C6` blue   | ▢ |
| `data`     | models, schemas, state, persistence       | `#9B6BD6` purple | ◆ |
| `network`  | transport, peer, API, signalling          | `#16A6A6` teal   | ⇄ |
| `util`     | pure helpers / shared utilities           | `#6B7280` slate  | ⚙ |
| `command`  | actions / commands / handlers             | `#D6557F` pink   | ▶ |
| `entry`    | entry points / bootstrap / app shell      | `#2FA84F` green  | ★ |
| `test`     | tests / fixtures                          | `#D9A521` amber  | ✓ |
| `external` | vendored / third-party                    | `#E0772B` orange | ◇ |
| *(unknown)*| no/unrecognised `@category`               | `#94A3B8` grey   | • |

These are first-draft choices to react to, not final.

**Single category now, tags later.** v1 uses one `category` string per file.
Category boundaries aren't always clean, so we may later move to an **ordered
tag list** where the *first* tag is the primary (→ colour) and secondary tags
get a lighter visual treatment (e.g. small dots/stripes). To keep that shift
cheap, the colour lookup already accepts either `category` *or* a `tags[]`
array (first element = primary), so adding tags is additive, not a rewrite.

## `graph.json` schema

The contract between analyser and UI (and the shape of the dummy file):

```jsonc
{
  "root": "app",                         // the analysed root (label only)
  "nodes": [
    {
      "id": "app/js/peer/mesh.js",       // unique; use repo-relative path
      "name": "mesh.js",                 // short label (Overview mode)
      "path": "app/js/peer/mesh.js",
      "category": "network",             // from @category; may be absent
      "description": "Maintains the WebRTC peer mesh...", // full comment text
      "loc": 240                         // lines of code → influences node size
    }
  ],
  "edges": [
    // source depends on target (source imports target).
    // "depends on" = outgoing; "depended on by" = incoming.
    { "source": "app/js/peer/mesh.js", "target": "app/js/peer/client.js" }
  ]
}
```

---

## Status

- [x] Choose visualiser library — **D3 (modular) with HTML-`div` nodes**
- [x] Create standalone `package.json`
- [x] Define `graph.json` schema + starter category palette
- [x] Hand-written dummy `graph.json` (real schema) to build UI against
- [x] Scaffold `index.html` + d3-force + zoom layers loading the dummy JSON
- [x] Overview mode — all nodes, minimal name-only visuals, box physics
- [x] Category styling (colours/symbols) with neutral fallback + legend
- [x] Vendor d3 locally (offline, no CDN)
- [x] Node analyser (scan → imports → @category/describe) → `graph.json`
- [x] Stamp `@category` into all 74 `app/` source files (scripts/add-categories.mjs)
- [x] Render real analyser output (74 files, 231 deps) with directed arrows
- [x] Synchronous initial layout + fit-to-view (robust to rAF throttling)
- [x] `index.*` nodes use their folder name (e.g. friends-page/index.js → "friends-page")
- [x] Hover highlight — dim others (softened + animated); ring the node + 1-hop
      neighbours; colour edges by direction (blue = depends-on, orange =
      depended-on-by); floating description card (screen space) placed by an
      outward search — nearest position that overlaps no highlighted node,
      preferring the side away from the cluster, drifting farther only when it
      must, then clamped to the viewport
- [x] Draggable nodes (pin where dropped, reheats sim) + background pan
- [ ] Focus mode — click a node → show it + 1-hop neighbors as rich boxes
- [ ] Overview ↔ Focus transition (circle→box morph, content cross-fade)
- [ ] Editable node content (in place; groundwork for full HTML editor)
- [ ] Grouping (convex hulls / d3-hierarchy)
- [ ] Filtering / search
- [ ] (Optional) Overview perf knobs — canvas circles / circle-collision force
- [ ] (Future) Human↔AI comment-edit loop

## Running

The app is plain static files — no build step, no `npm install` needed.

```bash
npm run dev          # python3 -m http.server 8088 (serves this folder)
# then open:
open http://localhost:8088/
```

**Must be served over HTTP — do not open `index.html` as a `file://`.** ES
modules and `fetch()` are blocked on the `file://` origin, which shows a blank
page. Any static server works (`npm run dev`, `npx serve`, etc.).

**Offline / no CDN.** `d3` is vendored as a single self-contained bundle at
`vendor/d3.js`; the import map maps the bare `d3-*` specifiers to it. Nothing is
fetched from the network at runtime. (When extracted and bundled with Vite, the
same `d3-*` imports resolve from `node_modules` instead.)

## Analysing a codebase

```bash
node src/analyser/cli.js <root> [--out data/graph.json]   # default root: ../app
```

The analyser walks the root (skipping `dist`/`vendor`/`node_modules`), extracts
each file's in-project imports and its leading description comment + `@category`,
and writes `data/graph.json` (gitignored; the UI loads it, falling back to the
committed `data/graph.sample.json`). Import resolution handles the `.js`-import →
`.ts`-file case and `index.*` directories.

`scripts/add-categories.mjs <root>` is the one-off (idempotent) migration that
stamped an `@category` tag into every `app/` source file's leading comment,
seeded from a directory→category map. Re-running skips already-tagged files.
