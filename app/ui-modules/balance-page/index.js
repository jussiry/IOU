/*
This module binds the balance page UI. It renders totals, populates list sections for debts and trust agreements, and controls expandable detail pills.

It keeps all balance-page specific rendering logic local to this module so the app shell can treat the page as a simple binder callback.
*/

import { formatCurrency, formatNet, formatSigned } from "../../js/ui/format.js";
import { isAcceptedFriendshipStatus } from "../../js/utils/friendships.js";

const closePanel = (button, panel) => {
  if (!panel || button.getAttribute("aria-expanded") !== "true") return;
  panel.style.height = `${panel.getBoundingClientRect().height}px`;
  requestAnimationFrame(() => {
    panel.style.height = "0px";
    panel.style.opacity = "0";
  });
  const onEnd = (event) => {
    if (event.propertyName !== "height") return;
    button.setAttribute("aria-expanded", "false");
    panel.removeEventListener("transitionend", onEnd);
  };
  panel.addEventListener("transitionend", onEnd);
};

const openPanel = (button, panel) => {
  if (!panel || button.getAttribute("aria-expanded") === "true") return;
  button.setAttribute("aria-expanded", "true");
  panel.style.height = "0px";
  panel.style.opacity = "0";
  requestAnimationFrame(() => {
    panel.style.height = `${panel.scrollHeight}px`;
    panel.style.opacity = "1";
  });
  const onEnd = (event) => {
    if (event.propertyName !== "height") return;
    panel.style.height = `${panel.scrollHeight}px`;
    panel.removeEventListener("transitionend", onEnd);
  };
  panel.addEventListener("transitionend", onEnd);
};

export const initBalanceToggles = (root) => {
  const groups = Array.from(root.querySelectorAll(".hero-sub"));
  groups.forEach((group) => {
    const toggleButtons = Array.from(group.querySelectorAll(".pill.toggle"));
    if (!toggleButtons.length) return;

    toggleButtons.forEach((button) => {
      const panel = button.querySelector(".sub-card");
      if (!panel) return;
      button.setAttribute("aria-expanded", "false");
      panel.style.height = "0px";
      panel.style.opacity = "0";

      button.addEventListener("click", () => {
        const isOpen = button.getAttribute("aria-expanded") === "true";
        toggleButtons.forEach((other) => {
          if (other === button) return;
          closePanel(other, other.querySelector(".sub-card"));
        });
        if (isOpen) {
          closePanel(button, panel);
        } else {
          openPanel(button, panel);
        }
      });
    });
  });
};

const renderInlineList = (root, list, templateSelector, options = {}) => {
  const container = root.querySelector(templateSelector.list);
  if (!container) return;
  container.innerHTML = "";

  const template = root.querySelector(templateSelector.template);
  if (!template) return;

  list.forEach((entry) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const nameEl = node.querySelector('[data-bind="name"]');
    const amountEl = node.querySelector('[data-bind="amount"]');
    if (nameEl) nameEl.textContent = entry.person_name || entry.name || entry.person_id;

    if (amountEl) {
      const amountValue = options.formatAmount
        ? options.formatAmount(entry)
        : formatSigned(entry.debt_eur);
      if (options.amountAsHtml) {
        amountEl.innerHTML = amountValue;
      } else {
        amountEl.textContent = amountValue;
      }
      if (!options.skipSignClass) {
        amountEl.classList.add(entry.debt_eur >= 0 ? "pos" : "neg");
      }
    }

    container.appendChild(node);
  });
};

export const bindBalance = (root, data) => {
  root.querySelector('[data-bind="net-balance"]').textContent = formatNet(
    data.totals.netBalance
  );
  root.querySelector('[data-bind="friends-owe-total"]').textContent = formatSigned(
    data.totals.friendsOweTotal
  );
  root.querySelector('[data-bind="you-owe-total"]').textContent = formatSigned(
    -data.totals.youOweTotal
  );
  const trustAgreementsTotalEl = root.querySelector(
    '[data-bind="trust-agreements-total"]'
  );
  if (trustAgreementsTotalEl) {
    const total = data.totals.trustAgreements || 0;
    trustAgreementsTotalEl.textContent = formatCurrency(total);
  }
  root.querySelector('[data-bind="available-trust"]').textContent = formatCurrency(
    data.totals.availableTrust
  );

  const acceptedFriends = data.friends.filter((friend) =>
    isAcceptedFriendshipStatus(friend.friendship_status)
  );

  const friendsOwe = acceptedFriends
    .filter((friend) => friend.debt_eur > 0)
    .sort((a, b) => b.debt_eur - a.debt_eur);

  const youOwe = acceptedFriends
    .filter((friend) => friend.debt_eur < 0)
    .sort((a, b) => Math.abs(b.debt_eur) - Math.abs(a.debt_eur));

  renderInlineList(root, friendsOwe, {
    list: '[data-list="friends-owe"]',
    template: '[data-template="trust-item"]',
  }, {
    skipSignClass: true,
  });
  renderInlineList(root, youOwe, {
    list: '[data-list="you-owe"]',
    template: '[data-template="trust-item"]',
  }, {
    skipSignClass: true,
  });

  const trustAgreements = acceptedFriends
    .filter((friend) => (friend.trust_credit_limit_eur || 0) > 0)
    .sort((a, b) => b.trust_credit_limit_eur - a.trust_credit_limit_eur);

  renderInlineList(
    root,
    trustAgreements,
    {
      list: '[data-list="trust-agreements"]',
      template: '[data-template="trust-item"]',
    },
    {
      formatAmount: (entry) => formatCurrency(entry.trust_credit_limit_eur || 0),
      amountAsHtml: false,
      skipSignClass: true,
    }
  );
};
