/*
This module owns active-state handling for primary navigation buttons. It updates visual active styles and aria-current attributes from a single function.

Centralizing nav state changes prevents duplicated button toggling logic across route handlers.
*/

export const setActiveNav = (navButtons, page) => {
  if (!page) {
    navButtons.forEach((button) => {
      button.classList.remove("active");
      button.removeAttribute("aria-current");
    });
    return;
  }
  navButtons.forEach((button) => {
    const isActive = button.dataset.page === page;
    button.classList.toggle("active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
};
