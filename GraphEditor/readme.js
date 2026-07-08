/*
 * readme.js — progressive enhancement for readme.html.
 *
 * The document is fully readable with this script disabled: every <section> is
 * present in the markup and simply stacks in one scroll. This script upgrades it
 * to a paged view — one section shown at a time, chosen by the URL hash — and
 * keeps the sidebar table of contents in sync. It adds `body.paged` so the CSS
 * knows to switch from stacked to paged; nothing here injects content, so the
 * raw HTML stays the single source of truth.
 */

(function () {
  const pages = [...document.querySelectorAll('.page')];
  const tocLinks = [...document.querySelectorAll('.toc-list a')];
  if (!pages.length) return;

  document.body.classList.add('paged');

  const byId = (id) => pages.find((p) => p.id === id);
  const firstId = pages[0].id;

  function show(id) {
    const page = byId(id) || pages[0];
    for (const p of pages) p.classList.toggle('active', p === page);
    for (const a of tocLinks) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + page.id);
    }
    document.body.classList.remove('nav-open'); // close mobile drawer on navigate
    document.getElementById('content').scrollTo?.(0, 0);
    window.scrollTo(0, 0);
    return page.id;
  }

  function fromHash() {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''));
    show(id || firstId);
  }

  // TOC / in-page links update the hash; the hashchange handler does the rest,
  // so back/forward navigation works for free.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    if (!byId(id)) return; // let non-section anchors behave normally
    e.preventDefault();
    if (location.hash === '#' + id) show(id); // re-click same page: no hashchange event
    else location.hash = id;
  });

  window.addEventListener('hashchange', fromHash);

  // Mobile: hamburger toggles the sidebar drawer.
  document.getElementById('nav-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });

  fromHash();
})();
