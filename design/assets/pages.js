/*
 * pages.js — the ordered index of every page in the Design site.
 *
 * This is the one piece of shared state across the standalone HTML pages: it
 * lets design.js build the same sidebar table of contents on every page without
 * each page having to list its siblings. Defined as a plain global (not fetched)
 * so the site works when opened directly from disk (file://) as well as served.
 *
 * Each entry: { href, title, status, group }. `status` uses the site
 * convention — implemented | planned | proposal | reference. Add a page here
 * when you add its .html file; keep the order meaningful (it's the reading /
 * nav order). Groups are section headers in the sidebar.
 */

window.DESIGN_PAGES = [
  { group: "Start here", href: "index.html", title: "Overview", status: "reference" },
  { group: "Reference", href: "glossary.html", title: "Glossary", status: "reference" },
];
