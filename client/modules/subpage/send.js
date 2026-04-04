/*
This module binds the send-IOU subpage form. It populates selectable friends, updates explanatory copy, and returns a payload reader for submit handling.

Only accepted friendships can be used for transactions, so the binder also owns the empty states shown when the user has no friends yet or only pending friendships.
*/

import { isAcceptedFriendshipStatus } from "../../js/utils/friendships.js";

const renderEmptyState = (contentEl, allConnections) => {
  if (!contentEl) {
    return;
  }

  const hasAnyConnections = Array.isArray(allConnections) && allConnections.length > 0;
  contentEl.innerHTML = hasAnyConnections
    ? `
      <div class="send-empty-state empty">
        No accepted friends yet. Complete a pending friendship or <a class="send-empty-link" href="#add-friend">add a new friend</a>
        before making a transaction.
      </div>
    `
    : `
      <div class="send-empty-state empty">
        No friends exist. <a class="send-empty-link" href="#add-friend">Add a new friend</a> to
        make your first transaction.
      </div>
    `;
};

export const bindSend = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const contentEl = root.querySelector(".send-content");
  const selectEl = root.querySelector('[data-bind="send-to"]');
  const explainerEl = root.querySelector('[data-bind="send-explainer"]');
  const amountEl = root.querySelector('[data-bind="send-amount"]');
  const messageEl = root.querySelector('[data-bind="send-message"]');
  const submitEl = root.querySelector('[data-bind="send-submit"]');

  if (titleEl) titleEl.textContent = "Send IOU";

  if (messageEl) {
    const autoGrow = () => {
      messageEl.style.height = "auto";
      messageEl.style.height = messageEl.scrollHeight + "px";
    };
    messageEl.addEventListener("input", autoGrow);
  }

  const allConnections = Array.isArray(data?.connections) ? data.connections : [];
  const acceptedConnections = allConnections
    .filter((connection) => isAcceptedFriendshipStatus(connection.friendship_status))
    .sort((leftConnection, rightConnection) => {
      const leftName = leftConnection.person_name || leftConnection.person_id || "";
      const rightName = rightConnection.person_name || rightConnection.person_id || "";
      return leftName.localeCompare(rightName);
    });
  if (!acceptedConnections.length) {
    renderEmptyState(contentEl, allConnections);
    return {
      submitEl: null,
      getPayload: () => ({
        friendId: "",
        amount: NaN,
        message: "",
      }),
    };
  }

  const getFirstName = (fullName) => fullName.split(/\s+/)[0] || fullName;

  const updateExplainer = (name, alternate) => {
    if (!explainerEl) return;
    const friendName = name ? getFirstName(name) : "your friend";
    const otherName = alternate ? getFirstName(alternate) : "another friend";
    explainerEl.innerHTML = `
      <p>When sending IOU's (I Owe You) you are <strong>making a promise</strong> of giving something of that value back some time later.</p>
      <p>This transaction can be redeemed by your friend sending their IOU's back to you. IOU's can also be redeemed in circular cancellation: <strong>you</strong> owe <strong>${friendName}</strong> who owes <strong>${otherName}</strong> who owes <strong>you</strong>. Circular cancellations are made automatically by the system.</p>
    `;
  };

  if (selectEl) {
    selectEl.innerHTML = "";
    acceptedConnections.forEach((connection) => {
      const option = document.createElement("option");
      option.value = connection.person_id;
      option.textContent = connection.person_name || connection.person_id;
      selectEl.appendChild(option);
    });

    const initialSelection =
      acceptedConnections.find((connection) => connection.person_id === friendId) ||
      acceptedConnections[0] ||
      null;
    if (initialSelection) {
      selectEl.value = initialSelection.person_id;
    }

    const selectAlternate = (currentId) => {
      const candidates = acceptedConnections.filter(
        (connection) => connection.person_id !== currentId
      );
      if (!candidates.length) return null;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return pick?.person_name || pick?.person_id || null;
    };

    const selected = acceptedConnections.find(
      (connection) => connection.person_id === selectEl.value
    );
    const selectedName = selected?.person_name || selected?.person_id;
    updateExplainer(selectedName, selectAlternate(selectEl.value));

    selectEl.addEventListener("change", () => {
      const current = acceptedConnections.find(
        (connection) => connection.person_id === selectEl.value
      );
      const name = current?.person_name || current?.person_id;
      updateExplainer(name, selectAlternate(selectEl.value));
    });
  } else {
    updateExplainer(null, null);
  }

  return {
    submitEl,
    getPayload: () => {
      const selectedId = selectEl?.value || acceptedConnections[0]?.person_id || "";
      const amount = amountEl ? parseFloat(amountEl.value) : NaN;
      const message = messageEl ? messageEl.value : "";
      return {
        friendId: selectedId,
        amount,
        message,
      };
    },
  };
};
