/*
This module adds horizontal swipe navigation to the app. Swiping left moves to the next main page in nav order, swiping right moves to the previous one. On subpages, swiping right triggers browser back navigation.

Touch handling uses a minimum distance threshold and angle check to avoid interfering with vertical scrolling.
@category ui
*/

const SWIPE_THRESHOLD = 50;
const MAX_VERTICAL_RATIO = 0.75;

export const initSwipeNavigation = (element, { navOrder, getIsSubpage, getCurrentPage }) => {
  let startX = 0;
  let startY = 0;

  element.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });

  element.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
    if (Math.abs(deltaY) / Math.abs(deltaX) > MAX_VERTICAL_RATIO) return;

    const isSwipeLeft = deltaX < 0;

    if (!isSwipeLeft && getIsSubpage()) {
      window.history.back();
      return;
    }

    const currentPage = getCurrentPage();
    const currentIndex = navOrder.indexOf(currentPage);
    if (currentIndex === -1) return;

    const nextIndex = isSwipeLeft ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= navOrder.length) return;

    window.location.hash = navOrder[nextIndex];
  }, { passive: true });
};
