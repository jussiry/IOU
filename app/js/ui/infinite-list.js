/*
This module provides a lazy-rendering list that appends items in batches as the user scrolls near the bottom of the page. It keeps initial render fast by only creating DOM nodes for the first page of items.

The caller provides items and a render function. This module handles batching, scroll observation, and cleanup.
@category ui
*/

const PAGE_SIZE = 20;
const SCROLL_MARGIN = 300;

export const initInfiniteList = (listEl, items, renderItem) => {
  if (!listEl || !items.length) return;

  let rendered = 0;
  let ticking = false;

  const renderBatch = () => {
    const end = Math.min(rendered + PAGE_SIZE, items.length);
    for (let i = rendered; i < end; i++) {
      const node = renderItem(items[i]);
      if (node) listEl.appendChild(node);
    }
    rendered = end;
  };

  const onScroll = () => {
    if (rendered >= items.length) {
      window.removeEventListener("scroll", onScroll);
      return;
    }
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const distanceToBottom =
        document.documentElement.scrollHeight -
        window.scrollY -
        window.innerHeight;
      if (distanceToBottom < SCROLL_MARGIN) {
        renderBatch();
      }
    });
  };

  renderBatch();
  if (rendered < items.length) {
    window.addEventListener("scroll", onScroll, { passive: true });
  }
};
