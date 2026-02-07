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
