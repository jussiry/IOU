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
})();
