/*
This module provides a lazy-rendering list that appends items in batches as the user scrolls near the bottom of the page. It keeps initial render fast by only creating DOM nodes for the first page of items.

The caller provides items and a render function. This module handles batching, scroll observation, and cleanup.

Scrolling happens inside the page view rather than on the window (each page is
its own scroll container so page transitions can hold two independent scroll
positions), so the listener attaches to the enclosing `.page-view`. It is found
with `closest`, which works while the page is still detached — binders run
before the page is mounted. The window is kept as a fallback.
@category ui
*/

const PAGE_SIZE = 20;
const SCROLL_MARGIN = 300;

export const initInfiniteList = (listEl, items, renderItem) => {
  if (!listEl || !items.length) return;

  const scroller = listEl.closest(".page-view");
  const scrollTarget = scroller || window;
  const distanceToBottom = () =>
    scroller
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      : document.documentElement.scrollHeight - window.scrollY - window.innerHeight;

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
      scrollTarget.removeEventListener("scroll", onScroll);
      return;
    }
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (distanceToBottom() < SCROLL_MARGIN) {
        renderBatch();
      }
    });
  };

  renderBatch();
  if (rendered < items.length) {
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
  }
};
