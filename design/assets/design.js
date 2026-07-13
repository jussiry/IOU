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
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.className = "outline-link";
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

  groups.forEach(function (g) {
    // Ungrouped (Overview): a plain top-level link, with its outline when open.
    if (g.name === null) {
      var top = makePageLink(g.pages[0]);
      top.classList.add("toc-top");
      toc.appendChild(top);
      if (isCurrent(g.pages[0]) && outline) toc.appendChild(outline);
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
      toc.appendChild(link);
      if (isCurrent(p) && outline) toc.appendChild(outline);
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
    toc.appendChild(btn);
    toc.appendChild(ul);
  });

  toc.addEventListener("click", function (e) {
    var groupBtn = e.target.closest("button.toc-group");
    if (groupBtn) {
      var isExpanded = groupBtn.getAttribute("aria-expanded") === "true";
      groupBtn.setAttribute("aria-expanded", String(!isExpanded));
      groupBtn.nextElementSibling.hidden = isExpanded;
      return;
    }
    if (e.target.closest("a")) document.body.classList.remove("nav-open");
  });

  document.body.insertBefore(toc, main);
  document.body.insertBefore(topbar, toc);
  document.body.insertBefore(makeSplitter("sidebar"), main);

  // Mobile drawer toggle
  topbar.querySelector(".nav-toggle").addEventListener("click", function () {
    document.body.classList.toggle("nav-open");
  });

  // Reflect the current page's status in the tab title prefix, cheap wayfinding.
  if (current && current.title) document.title = current.title + " — Design";

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
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
})();
