/*
This module renders the friends list page. It sorts friend connections, formats debt and agreement values, and binds click handlers to open friend detail pages.

The formatter helper keeps row amount markup consistent and avoids repeating debt/limit string assembly inside the render loop.
*/

import { formatSigned } from "../../js/utils/format.js";

const formatDebtWithLimit = (debtValue, creditLimitValue) => {
  const formattedDebt = formatSigned(debtValue).replace("€", "");
  const creditLimit = Math.round(creditLimitValue || 0);
  return `${formattedDebt} <span class="credit-limit">/ ${creditLimit} €</span>`;
};

const FLOATING_BUTTON_ID = "friends-add-button-floating";

const createFloatingButton = (inlineButton) => {
  const button = document.createElement("button");
  button.type = "button";
  button.id = FLOATING_BUTTON_ID;
  button.className = "friends-add-button friends-add-button--floating";
  button.setAttribute("aria-label", inlineButton.getAttribute("aria-label") || "Add a friend");
  button.innerHTML = inlineButton.innerHTML;
  return button;
};

const removeFloatingButton = () => {
  document.getElementById(FLOATING_BUTTON_ID)?.remove();
};

const isInlineButtonVisible = (button) => {
  const navEl = document.querySelector("nav");
  const buttonRect = button.getBoundingClientRect();
  const navTop = navEl?.getBoundingClientRect()?.top ?? window.innerHeight;
  const visibleBottom = Math.min(navTop, window.innerHeight) - 16;

  return buttonRect.top >= 0 && buttonRect.bottom <= visibleBottom;
};

const scheduleAfterLayout = (callback) => {
  let cancelled = false;

  requestAnimationFrame(() => {
    if (cancelled) return;
    requestAnimationFrame(() => {
      if (cancelled) return;
      callback();
    });
  });

  return () => {
    cancelled = true;
  };
};

export const bindFriends = (root, data) => {
  const listContainer = root.querySelector('[data-list="friends"]');
  const friendTemplate = root.querySelector('[data-template="friend-item"]');
  const addFriendButton = root.querySelector('[data-action="add-friend"]');
  if (!listContainer || !friendTemplate) return;

  listContainer.innerHTML = "";

  if (addFriendButton) {
    addFriendButton.addEventListener("click", () => {
      window.location.hash = "add-friend";
    });

    removeFloatingButton();
    addFriendButton.style.visibility = "";

    let floatingButton = null;

    const ensureFloatingButton = () => {
      if (floatingButton?.isConnected) {
        return floatingButton;
      }

      floatingButton = createFloatingButton(addFriendButton);
      floatingButton.addEventListener("click", () => {
        window.location.hash = "add-friend";
      });
      document.body.appendChild(floatingButton);
      return floatingButton;
    };

    const hideFloatingButton = () => {
      floatingButton?.remove();
      floatingButton = null;
    };

    const syncAddFriendButton = () => {
      if (!root.isConnected) return;
      const showFloating = !isInlineButtonVisible(addFriendButton);
      if (showFloating) {
        ensureFloatingButton();
        addFriendButton.style.visibility = "hidden";
        return;
      }

      hideFloatingButton();
      addFriendButton.style.visibility = "visible";
    };

    let rafId = 0;
    const scheduleSync = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        if (!root.isConnected) return;
        syncAddFriendButton();
      });
    };

    const controller = new AbortController();
    const cleanup = () => {
      controller.abort();
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      cancelInitialSync();
      hideFloatingButton();
      addFriendButton.style.visibility = "";
    };

    window.addEventListener("scroll", scheduleSync, {
      passive: true,
      signal: controller.signal,
    });
    window.addEventListener("resize", scheduleSync, {
      passive: true,
      signal: controller.signal,
    });
    window.addEventListener("hashchange", cleanup, {
      once: true,
      signal: controller.signal,
    });

    const cancelInitialSync = scheduleAfterLayout(syncAddFriendButton);
  }

  const sortedConnections = [...data.connections].sort(
    (a, b) => Math.abs(b.debt_eur) - Math.abs(a.debt_eur)
  );

  sortedConnections.forEach((connection) => {
    const node = friendTemplate.content.firstElementChild.cloneNode(true);
    const nameEl = node.querySelector('[data-bind="name"]');
    const badgeEl = node.querySelector('[data-bind="badge"]');
    const amountEl = node.querySelector('[data-bind="amount"]');
    node.addEventListener("click", () => {
      window.location.hash = `friend/${connection.person_id}`;
    });
    if (nameEl) nameEl.textContent = connection.person_name || connection.person_id;
    if (badgeEl) badgeEl.textContent = connection.debt_eur >= 0 ? "owes you" : "you owe";
    if (amountEl) {
      const debtValue = connection.debt_eur || 0;
      amountEl.innerHTML = formatDebtWithLimit(
        debtValue,
        connection.trust_credit_limit_eur
      );
      amountEl.classList.add(debtValue >= 0 ? "pos" : "neg");
    }

    listContainer.appendChild(node);
  });
};
