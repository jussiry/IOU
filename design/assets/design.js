/*
 * design.js — progressive enhancement for the Design site.
 *
 * Every page is fully readable without this script: the page's <main class="page">
 * is present in the markup and renders as a single column. This script upgrades
 * the layout to a topbar + sidebar-TOC shell by adding `body.enhanced` and
 * injecting the shared chrome, built from the window.DESIGN_PAGES manifest. It
 * injects only navigation — never page content — so the raw HTML of each page
 * stays the single source of truth.
 *
 * No fetch/network: the manifest is a global from pages.js, so this works when
 * pages are opened directly from disk (file://) as well as when served.
 */

(function () {
  var pages = Array.isArray(window.DESIGN_PAGES) ? window.DESIGN_PAGES : [];
  var main = document.querySelector("main.page");
  if (!main || !pages.length) return;

  // Which manifest entry is the current page? Match on the file name, tolerating
  // both "glossary.html" (file://, plain servers) and "/glossary" (static hosts
  // that serve clean URLs), plus "" / "/" for the index. So it works anywhere.
  var slug = function (s) {
    return (String(s).split("/").pop() || "").toLowerCase().replace(/\.html$/, "") || "index";
  };
  var here = slug(location.pathname);
  var current = pages.filter(function (p) {
    return slug(p.href) === here;
  })[0];

  document.body.classList.add("enhanced");
  applyStoredLayoutSize("sidebar");

  // ---- Top bar ----------------------------------------------------------
  var topbar = document.createElement("header");
  topbar.id = "topbar";
  topbar.innerHTML =
    '<span class="brand"><a href="index.html">Design</a></span>' +
    '<span class="tagline">Tally — system design &amp; docs</span>' +
    '<button class="nav-toggle" type="button" aria-label="Toggle navigation">☰</button>';

  // ---- Sidebar table of contents ---------------------------------------
  // Groups fold to just their header, except the group containing the current
  // page (open by default) or one the user expands — so the sidebar stays
  // scannable while always surfacing where you are. The open page also gets its
  // own headers (h2/h3/h4) rendered beneath it as a nested outline; navigating
  // to another page reloads and rebuilds this for that page only. A group with
  // a single page named after the group (Glossary, UI) has no fold — its header
  // is a direct link to that page.
  var toc = document.createElement("nav");
  toc.id = "toc";
  toc.setAttribute("aria-label", "Pages");

  var isCurrent = function (p) { return current && p.href === current.href; };

  // Build a nested outline of the current page's headings, giving each a stable
  // id (slugified) so the links resolve. Returns a <ul> or null if no headings.
  var outlineHeadings = [];
  var buildOutline = function () {
    var headings = main.querySelectorAll("h2, h3, h4");
    if (!headings.length) return null;
    var used = {};
    document.querySelectorAll("[id]").forEach(function (el) { used[el.id] = true; });
    var slugify = function (text) {
      var base = text.toLowerCase().trim().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "section";
      var s = base, n = 2;
      while (used[s]) s = base + "-" + n++;
      used[s] = true;
      return s;
    };
    var ul = document.createElement("ul");
    ul.className = "page-outline";
    headings.forEach(function (h) {
      if (!h.id) h.id = slugify(h.textContent);
      outlineHeadings.push(h);
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.className = "outline-link";
      a.setAttribute("data-outline-id", h.id);
      a.setAttribute("data-depth", String(Number(h.tagName.slice(1)) - 2)); // h2->0
      a.textContent = h.textContent;
      li.appendChild(a);
      ul.appendChild(li);
    });
    return ul;
  };
  var outline = buildOutline();

  var makePageLink = function (p) {
    var a = document.createElement("a");
    a.href = p.href;
    if (p.status) a.setAttribute("data-status", p.status);
    if (isCurrent(p)) a.classList.add("active");
    // The title lives in its own <span> (not a bare text node) so it — not the
    // whole flex row — is what shrinks and truncates; the dot stays fixed-size.
    a.innerHTML =
      '<span class="dot" aria-hidden="true"></span>' +
      '<span class="label">' + escapeHtml(p.title || p.href) + "</span>";
    return a;
  };

  // Bucket the manifest into ordered groups (ungrouped entries — the Overview —
  // become their own single-entry, nameless group rendered as a plain link).
  var groups = [];
  var byName = {};
  pages.forEach(function (p) {
    if (!p.group) { groups.push({ name: null, pages: [p] }); return; }
    if (!byName[p.group]) { byName[p.group] = { name: p.group, pages: [] }; groups.push(byName[p.group]); }
    byName[p.group].pages.push(p);
  });

  // The normal grouped navigation lives in its own wrapper so search can hide
  // it as a unit and show a flat results list in its place (see setupSearch).
  var tocNav = document.createElement("div");
  tocNav.id = "toc-nav";

  groups.forEach(function (g) {
    // Ungrouped (Overview): a plain top-level link, with its outline when open.
    if (g.name === null) {
      var top = makePageLink(g.pages[0]);
      top.classList.add("toc-top");
      tocNav.appendChild(top);
      if (isCurrent(g.pages[0]) && outline) tocNav.appendChild(outline);
      return;
    }

    // Single page named after its group → the header itself is the link.
    if (g.pages.length === 1 && g.pages[0].title === g.name) {
      var p = g.pages[0];
      var link = document.createElement("a");
      link.href = p.href;
      link.className = "toc-group toc-group-link";
      if (p.status) link.setAttribute("data-status", p.status);
      if (isCurrent(p)) link.classList.add("active", "has-active");
      link.innerHTML = '<span class="toc-group-label">' + escapeHtml(g.name) + "</span>";
      tocNav.appendChild(link);
      if (isCurrent(p) && outline) tocNav.appendChild(outline);
      return;
    }

    // Otherwise a foldable group of page links.
    var hasActive = g.pages.some(isCurrent);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toc-group" + (hasActive ? " has-active" : "");
    btn.setAttribute("aria-expanded", String(hasActive));
    btn.innerHTML =
      '<span class="toc-group-label">' + escapeHtml(g.name) + "</span>" +
      '<span class="toc-group-caret" aria-hidden="true"></span>';
    var ul = document.createElement("ul");
    ul.hidden = !hasActive;
    g.pages.forEach(function (p) {
      var li = document.createElement("li");
      li.appendChild(makePageLink(p));
      if (isCurrent(p) && outline) li.appendChild(outline); // outline nested under the active page
      ul.appendChild(li);
    });
    tocNav.appendChild(btn);
    tocNav.appendChild(ul);
  });

  toc.addEventListener("click", function (e) {
    var groupBtn = e.target.closest("button.toc-group");
    if (groupBtn) {
      var isExpanded = groupBtn.getAttribute("aria-expanded") === "true";
      groupBtn.setAttribute("aria-expanded", String(!isExpanded));
      groupBtn.nextElementSibling.hidden = isExpanded;
      return;
    }
    var outlineLink = e.target.closest("a.outline-link");
    if (outlineLink) {
      var id = outlineLink.getAttribute("data-outline-id");
      var heading = id && document.getElementById(id);
      if (heading) {
        e.preventDefault();
        history.pushState(history.state, "", location.pathname + location.search + "#" + id);
        scrollHeadingIntoView(heading);
        updateActiveOutlineLink(id);
      }
    }
    if (e.target.closest("a")) document.body.classList.remove("nav-open");
  });

  // Search box (top) + the grouped nav + an (initially empty) results list.
  var search = buildSearchBox();
  toc.appendChild(search.box);
  toc.appendChild(tocNav);
  var tocResults = document.createElement("div");
  tocResults.id = "toc-results";
  tocResults.hidden = true;
  toc.appendChild(tocResults);

  document.body.insertBefore(toc, main);
  document.body.insertBefore(topbar, toc);
  document.body.insertBefore(makeSplitter("sidebar"), main);
  setupHeadingScrollSpy(outlineHeadings);
  setupSearch({ input: search.input, clearBtn: search.clearBtn, tocNav: tocNav, tocResults: tocResults });
  setupEditing();

  // Mobile drawer toggle
  topbar.querySelector(".nav-toggle").addEventListener("click", function () {
    document.body.classList.toggle("nav-open");
  });

  // Reflect the current page's status in the tab title prefix, cheap wayfinding.
  if (current && current.title) document.title = current.title + " — Design";

  // Optional third column: the embedded GraphEditor, opened from documented
  // headers. No-op on pages without graph metadata.
  setupGraphColumn();

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function setupHeadingScrollSpy(headings) {
    if (!headings.length || !history.replaceState) {
      updateActiveOutlineLink(location.hash.replace(/^#/, ""));
      return;
    }

    var ticking = false;
    var lastActiveId = location.hash.replace(/^#/, "");
    var suppressScrollSpy = false;
    var scrollContainer = main;
    var topSlack = 32;

    var update = function () {
      ticking = false;
      var active = headings[0];
      var containerTop = scrollContainer.getBoundingClientRect().top;

      headings.forEach(function (h) {
        if (h.getBoundingClientRect().top - containerTop <= topSlack) active = h;
      });

      if (!active || active.id === lastActiveId) return;
      lastActiveId = active.id;
      var nextUrl = location.pathname + location.search + "#" + active.id;
      history.replaceState(history.state, "", nextUrl);
      updateActiveOutlineLink(active.id);
    };

    var schedule = function () {
      if (suppressScrollSpy) return;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    scrollContainer.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", function () {
      lastActiveId = location.hash.replace(/^#/, "");
      updateActiveOutlineLink(lastActiveId);
      var heading = lastActiveId && document.getElementById(lastActiveId);
      if (heading) scrollHeadingIntoView(heading);
      schedule();
    });

    if (lastActiveId) {
      updateActiveOutlineLink(lastActiveId);
      var initialHeading = document.getElementById(lastActiveId);
      if (initialHeading) {
        suppressScrollSpy = true;
        requestAnimationFrame(function () {
          scrollHeadingIntoView(initialHeading);
          requestAnimationFrame(function () {
            suppressScrollSpy = false;
            schedule();
          });
        });
        return;
      }
    }
    requestAnimationFrame(update);
  }

  function scrollHeadingIntoView(heading) {
    main.scrollTo({
      top: main.scrollTop + heading.getBoundingClientRect().top - main.getBoundingClientRect().top,
      left: main.scrollLeft,
      behavior: "auto",
    });
  }

  function updateActiveOutlineLink(id) {
    toc.querySelectorAll(".outline-link.active").forEach(function (a) {
      a.classList.remove("active");
      a.removeAttribute("aria-current");
    });
    if (!id) return;
    var active = Array.from(toc.querySelectorAll(".outline-link")).filter(function (a) {
      return a.getAttribute("data-outline-id") === id;
    })[0];
    if (!active) return;
    active.classList.add("active");
    active.setAttribute("aria-current", "location");
  }

  function makeSplitter(name) {
    var splitter = document.createElement("div");
    splitter.className = "layout-splitter";
    splitter.setAttribute("data-splitter", name);
    splitter.setAttribute("role", "separator");
    splitter.setAttribute("aria-orientation", "vertical");
    splitter.setAttribute("aria-label", name === "sidebar" ? "Resize navigation" : "Resize graph editor");
    splitter.tabIndex = 0;

    var config = getSplitterConfig(name);
    var updateValue = function (value) {
      var clamped = clamp(value, config.min, getMaxWidth(config));
      document.documentElement.style.setProperty(config.variable, Math.round(clamped) + "px");
      splitter.setAttribute("aria-valuenow", String(Math.round(clamped)));
      storeLayoutSize(name, clamped);
    };
    var currentValue = function () {
      return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(config.variable)) || config.defaultValue;
    };

    splitter.setAttribute("aria-valuemin", String(config.min));
    splitter.setAttribute("aria-valuemax", String(getMaxWidth(config)));
    splitter.setAttribute("aria-valuenow", String(Math.round(currentValue())));

    splitter.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      document.body.classList.add("is-resizing-layout");
      var startX = e.clientX;
      var startWidth = currentValue();
      var direction = config.side === "right" ? -1 : 1;

      var move = function (moveEvent) {
        updateValue(startWidth + (moveEvent.clientX - startX) * direction);
      };
      var stop = function () {
        document.body.classList.remove("is-resizing-layout");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        splitter.removeEventListener("lostpointercapture", stop);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      splitter.addEventListener("lostpointercapture", stop);
    });

    splitter.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 40 : 16;
      if (e.key === "ArrowLeft") { e.preventDefault(); updateValue(currentValue() - step); }
      if (e.key === "ArrowRight") { e.preventDefault(); updateValue(currentValue() + step); }
      if (e.key === "Home") { e.preventDefault(); updateValue(config.min); }
      if (e.key === "End") { e.preventDefault(); updateValue(getMaxWidth(config)); }
    });

    splitter.addEventListener("dblclick", function () {
      updateValue(config.defaultValue);
    });

    return splitter;
  }

  function getSplitterConfig(name) {
    if (name === "graph") {
      return { variable: "--graph-w", storageKey: "design.graphWidth", min: 260, maxRatio: 0.5, defaultValue: 380, side: "right" };
    }
    return { variable: "--sidebar-w", storageKey: "design.sidebarWidth", min: 200, maxRatio: 0.45, defaultValue: 272, side: "left" };
  }

  function applyStoredLayoutSize(name) {
    var config = getSplitterConfig(name);
    try {
      var stored = Number(localStorage.getItem(config.storageKey));
      if (Number.isFinite(stored)) {
        document.documentElement.style.setProperty(config.variable, Math.round(clamp(stored, config.min, getMaxWidth(config))) + "px");
      }
    } catch (e) {
      // Storage is optional; direct file access and strict privacy modes still work.
    }
  }

  function storeLayoutSize(name, value) {
    try {
      localStorage.setItem(getSplitterConfig(name).storageKey, String(Math.round(value)));
    } catch (e) {
      // Ignore storage failures; the live resize has already been applied.
    }
  }

  function getMaxWidth(config) {
    return Math.max(config.min, Math.round(window.innerWidth * config.maxRatio));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // ---- Graph column (embedded GraphEditor) ------------------------------
  // A page documents which code files it covers via hidden `data-files`
  // metadata — one list for the whole document (on <main>, its icon sits by the
  // <h1>) or one per root-level section (on each <h2>). For every such list we
  // inject a graph icon that opens a third column hosting the standalone
  // GraphEditor in an iframe, filtered to exactly those files (its "custom"
  // category — an ordinary, toggleable legend entry there, named after the
  // heading it came from). GraphEditor stays independent; we drive it purely
  // over postMessage:
  //   design → editor : { type:'showNodes', ids:[...], name } | { type:'clearFilter' }
  //   editor → design : { source:'graph-editor', type:'ready' | 'close' }
  // The editor announces `ready` after load; commands sent earlier are queued.
  function setupGraphColumn() {
    var sources = collectFileSources();
    if (!sources.length) return; // page has no graph metadata → stay two-column

    var GRAPH_EDITOR_URL = window.GRAPH_EDITOR_URL || "http://localhost:8088/index.html";

    applyStoredLayoutSize("graph");

    var splitter = makeSplitter("graph");
    var panel = document.createElement("section");
    panel.id = "graph-panel";
    panel.setAttribute("aria-label", "Graph editor");
    var iframe = document.createElement("iframe");
    iframe.id = "graph-frame";
    iframe.title = "Graph editor";
    panel.appendChild(iframe);
    document.body.appendChild(splitter);
    document.body.appendChild(panel);

    var ready = false;
    var pending = null;   // command buffered until the iframe reports ready
    var activeKey = null; // which header's icon is currently lit

    var send = function (msg) {
      if (ready && iframe.contentWindow) iframe.contentWindow.postMessage(msg, "*");
      else pending = msg;
    };

    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.source !== "graph-editor") return;
      if (d.type === "ready") {
        ready = true;
        if (pending) { iframe.contentWindow.postMessage(pending, "*"); pending = null; }
      } else if (d.type === "close") {
        closeGraph();
      }
    });

    var setActive = function (key) {
      activeKey = key;
      var btns = document.querySelectorAll(".graph-open-btn");
      Array.prototype.forEach.call(btns, function (b) {
        b.classList.toggle("active", b.getAttribute("data-graph-key") === key);
      });
    };
    var closeGraph = function () {
      document.body.classList.remove("graph-open");
      setActive(null);
    };
    var openGraph = function (src) {
      if (!iframe.src) {
        iframe.src = GRAPH_EDITOR_URL + (GRAPH_EDITOR_URL.indexOf("?") < 0 ? "?" : "&") + "embed=1";
      }
      document.body.classList.add("graph-open");
      send({ type: "showNodes", ids: src.files, name: src.name });
      setActive(src.key);
    };

    sources.forEach(function (src) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "graph-open-btn";
      btn.setAttribute("data-graph-key", src.key);
      btn.title = "Show this section's files in the graph (" + src.files.length + ")";
      btn.setAttribute("aria-label", btn.title);
      btn.innerHTML = graphIcon();
      btn.addEventListener("click", function () {
        if (activeKey === src.key && document.body.classList.contains("graph-open")) closeGraph();
        else openGraph(src);
      });
      src.headingEl.appendChild(btn);
    });
  }

  // Gather the page's documented file lists. `<main data-files>` is the whole
  // document (icon anchored to its <h1>); each `<h2 data-files>` is one section;
  // each `<dt data-files>` is one glossary term. `name` (the element's own text,
  // read before the icon button is appended into it) becomes the custom
  // category's label in the embedded GraphEditor — for a term we take the first
  // synonym (before any comma), e.g. "Record, Durable message" → "Record".
  function collectFileSources() {
    var out = [];
    var wholeAttr = main.getAttribute("data-files");
    var h1 = main.querySelector("h1");
    if (wholeAttr && h1) out.push({ headingEl: h1, files: parseFiles(wholeAttr), key: "whole", name: h1.textContent.trim() });
    var els = main.querySelectorAll("h2[data-files], dt[data-files]");
    Array.prototype.forEach.call(els, function (el, i) {
      if (!el.id) el.id = "graph-section-" + i;
      var text = el.textContent.trim();
      var name = el.tagName === "DT" ? text.split(",")[0].trim() : text;
      out.push({ headingEl: el, files: parseFiles(el.getAttribute("data-files")), key: el.id, name: name });
    });
    return out.filter(function (s) { return s.files.length; });
  }

  function parseFiles(s) {
    return String(s).split(/[\s,]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function graphIcon() {
    return (
      '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
      '<path d="M6 13.2 L13 6.2 M6.6 13.8 L14 14.4" stroke="currentColor" stroke-width="1.3" fill="none"/>' +
      '<circle cx="5" cy="14.5" r="2.4"/><circle cx="14.5" cy="5.2" r="2.4"/><circle cx="15" cy="14.8" r="2.1"/>' +
      "</svg>"
    );
  }

  // ---- Sidebar search ---------------------------------------------------
  // A search box at the top of the sidebar searches the full text of *every*
  // page (fetched lazily and cached on first use — needs HTTP, degrades to no
  // results on file://). Matches replace the grouped nav with a flat list of
  // matching documents. Opening a result carries the query in `?q=`, and on the
  // next page load we highlight every match in the document and scroll to the
  // first — so the search box stays populated and results stay listed, letting
  // you hop between matching documents.
  function buildSearchBox() {
    var box = document.createElement("div");
    box.id = "toc-search";
    var input = document.createElement("input");
    input.type = "text";
    input.id = "toc-search-input";
    input.placeholder = "Search docs…";
    input.setAttribute("aria-label", "Search documentation");
    input.autocomplete = "off";
    input.spellcheck = false;
    var clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.id = "toc-search-icon";
    clearBtn.tabIndex = -1;
    clearBtn.setAttribute("aria-label", "Clear search");
    clearBtn.innerHTML =
      '<svg class="icon-search" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
      '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13 L17.5 17.5" stroke-linecap="round"/></svg>' +
      '<svg class="icon-clear" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
      '<path d="M5 5 L15 15 M15 5 L5 15" stroke-linecap="round"/></svg>';
    box.appendChild(input);
    box.appendChild(clearBtn);
    return { box: box, input: input, clearBtn: clearBtn };
  }

  function setupSearch(opts) {
    var input = opts.input, clearBtn = opts.clearBtn, tocNav = opts.tocNav, tocResults = opts.tocResults;
    var box = input.parentNode;
    var docsCache = null; // Promise<[{href,title,text}]> — built once, reused
    // The active query is carried across page loads in sessionStorage rather
    // than the URL: clean-URL static hosts (e.g. `serve`) 301-redirect
    // page.html → /page and drop the query string, which would lose it.
    var SEARCH_KEY = "design.searchQuery";
    var readStored = function () { try { return sessionStorage.getItem(SEARCH_KEY) || ""; } catch (e) { return ""; } };
    var writeStored = function (v) { try { if (v) sessionStorage.setItem(SEARCH_KEY, v); else sessionStorage.removeItem(SEARCH_KEY); } catch (e) {} };

    function loadDocs() {
      if (docsCache) return docsCache;
      docsCache = Promise.all(pages.map(function (p) {
        return fetch(p.href)
          .then(function (r) { return r.ok ? r.text() : ""; })
          .then(function (html) {
            var text = "";
            try {
              var doc = new DOMParser().parseFromString(html, "text/html");
              var m = doc.querySelector("main.page");
              text = (m ? m.textContent : "").replace(/\s+/g, " ").trim();
            } catch (e) { /* ignore parse errors */ }
            return { href: p.href, title: p.title || p.href, text: text };
          })
          .catch(function () { return { href: p.href, title: p.title || p.href, text: "" }; });
      }));
      return docsCache;
    }

    function countMatches(haystack, needle) {
      var count = 0, idx = haystack.indexOf(needle);
      while (idx !== -1) { count++; idx = haystack.indexOf(needle, idx + needle.length); }
      return count;
    }

    function renderResults(query) {
      var q = query.toLowerCase();
      loadDocs().then(function (docs) {
        if (input.value.trim().toLowerCase() !== q) return; // superseded while fetching
        var hits = [];
        docs.forEach(function (d) {
          var c = countMatches(d.text.toLowerCase(), q);
          if (c) hits.push({ doc: d, count: c });
        });
        hits.sort(function (a, b) { return b.count - a.count; });

        tocResults.innerHTML = "";
        var summary = document.createElement("div");
        summary.className = "search-summary";
        // Cross-document search reads each page over HTTP; on the file:// origin
        // those fetches are blocked, so every doc comes back empty. Say so
        // rather than showing a bare "No matches".
        var noneLoaded = docs.every(function (d) { return !d.text; });
        summary.textContent = hits.length
          ? hits.length + " document" + (hits.length > 1 ? "s" : "")
          : (noneLoaded && location.protocol === "file:")
          ? "Search needs the dev server (npm run dev:design)"
          : "No matches";
        tocResults.appendChild(summary);

        hits.forEach(function (h) {
          var a = document.createElement("a");
          a.className = "search-result";
          a.href = h.doc.href; // query travels in sessionStorage, not the URL
          if (slug(h.doc.href) === here) a.classList.add("active");
          a.innerHTML =
            '<span class="search-result-title">' + escapeHtml(h.doc.title) + "</span>" +
            '<span class="search-result-count">' + h.count + "</span>";
          tocResults.appendChild(a);
        });
      });
    }

    function enterSearch(query) {
      box.classList.add("has-text");
      tocNav.hidden = true;
      tocResults.hidden = false;
      writeStored(query);
      renderResults(query);
    }
    function exitSearch() {
      box.classList.remove("has-text");
      tocResults.hidden = true;
      tocResults.innerHTML = "";
      tocNav.hidden = false;
      unhighlightMatches(); // drop any highlights on the current page
      writeStored(""); // so a reload / next page returns to the normal sidebar
    }

    var timer = null;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      var v = input.value.trim();
      if (!v) { exitSearch(); return; }
      box.classList.add("has-text"); // flip icon immediately; results after the debounce
      timer = setTimeout(function () { enterSearch(v); }, 150);
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && input.value) { input.value = ""; exitSearch(); }
      if (e.key === "Enter") {
        var first = tocResults.querySelector("a.search-result");
        if (first) { e.preventDefault(); window.location.href = first.href; }
      }
    });

    clearBtn.addEventListener("click", function () {
      if (input.value) { input.value = ""; exitSearch(); }
      input.focus();
    });

    // Restore an in-progress search on load, and highlight this page's matches.
    var initialQ = readStored();
    if (initialQ && initialQ.trim()) {
      input.value = initialQ;
      enterSearch(initialQ.trim());
      highlightMatches(initialQ.trim());
    }
  }

  // Wrap every occurrence of `query` in the current page's <main> with a
  // <mark>, then scroll the first one near the top. Text nodes are collected
  // before any mutation so the walk isn't disturbed by the wrapping.
  function highlightMatches(query) {
    var needle = String(query).toLowerCase();
    if (!needle) return;
    var walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.toLowerCase().indexOf(needle) === -1) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);

    var first = null;
    nodes.forEach(function (node) {
      var text = node.nodeValue, lower = text.toLowerCase();
      var frag = document.createDocumentFragment();
      var i = 0, idx;
      while ((idx = lower.indexOf(needle, i)) !== -1) {
        if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
        var mark = document.createElement("mark");
        mark.className = "search-hit";
        mark.textContent = text.slice(idx, idx + needle.length);
        frag.appendChild(mark);
        if (!first) first = mark;
        i = idx + needle.length;
      }
      if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
      node.parentNode.replaceChild(frag, node);
    });

    if (first) {
      first.classList.add("search-hit-first");
      requestAnimationFrame(function () {
        var top = main.scrollTop + first.getBoundingClientRect().top - main.getBoundingClientRect().top - 48;
        main.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      });
    }
  }

  // Reverse highlightMatches: unwrap each <mark> back to plain text.
  function unhighlightMatches() {
    var marks = main.querySelectorAll("mark.search-hit");
    if (!marks.length) return;
    marks.forEach(function (m) {
      m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    });
    main.normalize(); // merge the text nodes back together
  }

  // ---- Inline editing ---------------------------------------------------
  // Click a block of text to edit it: it turns into a textarea holding the
  // block's markdown. Enter commits (markdown → HTML, applied both to the live
  // page and, via the dev server's /api/save, to the source .html file);
  // Shift+Enter inserts a newline; Esc cancels. Needs the dev server (see
  // design/scripts/serve.mjs) — a no-op when the save request can't be made.
  //
  // Only prose blocks are editable; dt/dd (glossary) are left out because their
  // term-self links and graph icons don't round-trip through plain markdown.
  var EDIT_BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote";
  var pageFile = here + ".html";

  function setupEditing() {
    var active = null; // { el, textarea, index }

    main.addEventListener("click", function (e) {
      if (active) return;
      if (e.target.closest("a, button, input, textarea, select, summary, label, .graph-open-btn")) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length) return; // don't hijack a text selection
      var block = e.target.closest(EDIT_BLOCK_SELECTOR);
      if (!block || !main.contains(block)) return;
      if ((block.tagName === "UL" || block.tagName === "OL") && block.querySelector("ul, ol")) return; // skip nested lists
      beginEdit(block);
    });

    function beginEdit(el) {
      var blocks = Array.prototype.slice.call(main.querySelectorAll(EDIT_BLOCK_SELECTOR));
      var index = blocks.indexOf(el);
      if (index < 0) return;
      var ta = document.createElement("textarea");
      ta.className = "doc-edit";
      ta.value = blockToMarkdown(el);
      ta.setAttribute("aria-label", "Edit content");
      el.style.display = "none";
      el.parentNode.insertBefore(ta, el);
      autosize(ta);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      active = { el: el, textarea: ta, index: index };

      ta.addEventListener("input", function () { autosize(ta); });
      ta.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") { ev.preventDefault(); cleanup(); }
        else if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); commit(); }
        // Shift+Enter falls through to the textarea's default newline.
      });
    }

    function cleanup() {
      if (!active) return;
      active.textarea.remove();
      active.el.style.display = "";
      active = null;
    }

    function commit() {
      var ed = active;
      var newMd = ed.textarea.value;
      // Update the live block, preserving an injected graph icon if present.
      var injected = ed.el.querySelector(":scope > .graph-open-btn");
      applyMarkdown(ed.el, newMd);
      if (injected) ed.el.appendChild(injected);
      cleanup();
      saveToSource(ed.index, newMd).catch(function (err) {
        console.error("[design] inline-edit save failed:", err);
      });
    }

    // Write the edited block back to the source file. The block is located by
    // its index among EDIT_BLOCK_SELECTOR matches, which is identical in the
    // (clean) source and the live DOM — the injected chrome lives outside
    // <main> and the graph icons aren't block-level, so neither shifts the
    // indexing. Only <main>'s inner HTML is spliced back into the original text,
    // so everything else (authored comment, doctype, <head>, <main>'s own
    // attributes, scripts) stays byte-for-byte unchanged.
    function saveToSource(index, newMd) {
      return fetch(pageFile).then(function (res) {
        if (!res.ok) throw new Error("could not read source (" + res.status + ")");
        return res.text();
      }).then(function (text) {
        var doc = new DOMParser().parseFromString(text, "text/html");
        var srcMain = doc.querySelector("main.page");
        if (!srcMain) throw new Error("no <main class=page> in source");
        var target = srcMain.querySelectorAll(EDIT_BLOCK_SELECTOR)[index];
        if (!target) throw new Error("block " + index + " not found in source");
        applyMarkdown(target, newMd);

        var open = text.search(/<main[\s>]/i);
        var openEnd = open >= 0 ? text.indexOf(">", open) : -1;
        var close = text.lastIndexOf("</main>");
        if (open < 0 || openEnd < 0 || close < 0 || close < openEnd) {
          throw new Error("could not locate <main> in source");
        }
        var out = text.slice(0, openEnd + 1) + srcMain.innerHTML + text.slice(close);
        return fetch("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: pageFile, html: out }),
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.ok) throw new Error((data && data.error) || ("save failed (" + res.status + ")"));
        });
      });
    }
  }

  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  // ---- Minimal HTML ⇄ markdown for the editable inline subset -----------
  // Supported inline grammar: **bold**, *italic*, `code`, [text](url). Blocks:
  // paragraphs/headings/blockquotes (inline content) and ul/ol (one item per
  // line). Enough for how these docs are authored; anything richer is left as-is.
  function collapseWs(s) { return String(s).replace(/\s+/g, " ").trim(); }

  function inlineToMarkdown(node) {
    var out = "";
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) { out += child.nodeValue; return; }
      if (child.nodeType !== 1) return;
      if (child.classList && child.classList.contains("graph-open-btn")) return;
      var tag = child.tagName.toLowerCase();
      if (tag === "br") { out += "\n"; return; }
      if (tag === "code") { out += "`" + child.textContent + "`"; return; }
      var inner = inlineToMarkdown(child);
      if (tag === "strong" || tag === "b") out += "**" + inner + "**";
      else if (tag === "em" || tag === "i") out += "*" + inner + "*";
      else if (tag === "a") out += "[" + inner + "](" + (child.getAttribute("href") || "") + ")";
      else out += inner; // span, mark (search), etc. — keep the text
    });
    return out;
  }

  function blockToMarkdown(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      var items = Array.prototype.filter.call(el.children, function (c) { return c.tagName === "LI"; });
      return items.map(function (li, i) {
        return (tag === "ol" ? (i + 1) + ". " : "- ") + collapseWs(inlineToMarkdown(li));
      }).join("\n");
    }
    return collapseWs(inlineToMarkdown(el));
  }

  function inlineMarkdownToHtml(md) {
    var s = String(md).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, t, u) {
      return '<a href="' + u.replace(/"/g, "&quot;") + '">' + t + "</a>";
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return "<code>" + codes[+i] + "</code>"; });
    return s;
  }

  function applyMarkdown(el, md) {
    var tag = el.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      var items = String(md).split("\n").map(function (l) {
        return l.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
      }).filter(function (l) { return l.length; });
      el.innerHTML = items.map(function (it) { return "<li>" + inlineMarkdownToHtml(it) + "</li>"; }).join("");
    } else {
      el.innerHTML = String(md).split("\n").map(function (l) {
        return inlineMarkdownToHtml(l.trim());
      }).join("<br>");
    }
  }
})();
