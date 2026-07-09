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
  // page (open by default) and any group the user has manually expanded — so
  // the sidebar stays scannable on a site with many pages while always
  // surfacing where you are.
  var toc = document.createElement("nav");
  toc.id = "toc";
  toc.setAttribute("aria-label", "Pages");

  var currentGroup = current ? current.group : null;
  var lastGroup = null;
  var list = null;
  var groupButton = null;
  pages.forEach(function (p) {
    if (p.group && p.group !== lastGroup) {
      var isOpen = p.group === currentGroup;
      var h = document.createElement("button");
      h.type = "button";
      h.className = "toc-group";
      h.setAttribute("aria-expanded", String(isOpen));
      h.innerHTML =
        '<span class="toc-group-label">' + escapeHtml(p.group) + "</span>" +
        '<span class="toc-group-caret" aria-hidden="true"></span>';
      toc.appendChild(h);
      list = document.createElement("ul");
      list.hidden = !isOpen;
      toc.appendChild(list);
      lastGroup = p.group;
      groupButton = h;
    }
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = p.href;
    if (p.status) a.setAttribute("data-status", p.status);
    if (current && p.href === current.href) {
      a.classList.add("active");
      if (groupButton) groupButton.classList.add("has-active");
    }
    a.innerHTML = '<span class="dot" aria-hidden="true"></span>' + escapeHtml(p.title || p.href);
    li.appendChild(a);
    (list || toc).appendChild(li);
  });

  toc.addEventListener("click", function (e) {
    var groupBtn = e.target.closest(".toc-group");
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
