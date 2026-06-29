/*
This module owns active-state handling for primary navigation buttons. It updates visual active styles, aria-current attributes, and actionable-item badge counts from a single place.

Centralizing nav state changes prevents duplicated button toggling logic across route handlers.
@category ui
*/

import { hasActionableNotification } from "../utils/friendships.js";
import { isUpdateAvailable } from "./app-update.js";

const getActionableCountsByPage = (data) => {
  const counts = {};

  // Settings has no notifications of its own, so a pending app update surfaces
  // there as a single badge prompting the user to apply it.
  if (isUpdateAvailable()) counts.settings = 1;

  if (!data?.friends) return counts;

  const friendsCount = data.friends.filter(hasActionableNotification).length;
  if (friendsCount > 0) counts.friends = friendsCount;

  return counts;
};

export const updateNavBadges = (navButtons, data) => {
  const counts = getActionableCountsByPage(data);

  navButtons.forEach((button) => {
    const page = button.dataset.page;
    let badge = button.querySelector(".nav-badge");
    const count = counts[page] || 0;

    if (count === 0) {
      if (badge) badge.hidden = true;
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-badge";
      button.style.position = "relative";
      button.appendChild(badge);
    }

    badge.textContent = count;
    badge.hidden = false;
  });
};

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
