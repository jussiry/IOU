/*
This module binds the friend detail subpage. It renders debt/credit summary cards, injects friend-specific labels, and lists recent transactions.

It also exposes navigation triggers to related subpages by wiring the credit tile click target from the current friend context.
*/

import { acceptFriend, rejectFriend } from "../../js/data.js";
import {
  FRIENDSHIP_STATUS_ACCEPTED,
  FRIENDSHIP_STATUS_PENDING_INCOMING,
  FRIENDSHIP_STATUS_PENDING_OUTGOING,
  FRIENDSHIP_STATUS_REJECTED,
  isAcceptedFriendshipStatus,
} from "../../js/utils/friendships.js";
import { formatCurrency, formatDate, formatSigned } from "../../js/utils/format.js";

export const bindFriendDetail = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const labelEl = root.querySelector('[data-bind="friend-label"]');
  const headerRight = root.querySelector('[data-slot="subpage-header-right"]');
  const bodyEl = root.querySelector('[data-section="friend-body"]');
  const debtLabelEl = root.querySelector('[data-bind="debt-label"]');
  const debtAmountEl = root.querySelector('[data-bind="debt-amount"]');
  const creditTitleEl = root.querySelector('[data-bind="credit-title"]');
  const creditAmountEl = root.querySelector('[data-bind="credit-amount"]');
  const creditButton = root.querySelector('[data-section="credit-limit"]');
  const listEl = root.querySelector('[data-list="friend-transactions"]');
  const txTemplate = root.querySelector('[data-template="tx-item"]');

  const connection = data.connections.find((entry) => entry.person_id === friendId);
  const friendName = connection?.person_name || "Friend";
  const friendFirstName = friendName.split(/\s+/)[0] || friendName;
  const friendshipStatus = connection?.friendship_status || FRIENDSHIP_STATUS_ACCEPTED;

  if (titleEl) titleEl.textContent = friendName;
  if (labelEl) {
    labelEl.textContent = isAcceptedFriendshipStatus(friendshipStatus)
      ? `My transactions with ${friendFirstName}`
      : `Friendship with ${friendFirstName}`;
  }
  if (headerRight) {
    if (friendshipStatus === FRIENDSHIP_STATUS_ACCEPTED) {
      headerRight.innerHTML = `
        <button class="friend-send surface-box" type="button" data-action="send" aria-label="Send IOU">
          <svg class="friend-send-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <use href="#icon-send" />
          </svg>
          <span class="friend-send-label">Send</span>
        </button>
      `;
    } else if (friendshipStatus === FRIENDSHIP_STATUS_PENDING_INCOMING) {
      headerRight.innerHTML = `
        <button class="friend-inline-action friend-inline-action--primary surface-box" type="button" data-action="accept-friend">
          Accept
        </button>
        <button class="friend-inline-action surface-box" type="button" data-action="reject-friend">
          Reject
        </button>
      `;
    } else {
      headerRight.innerHTML = `
        <span class="friend-status-chip surface-box">${friendshipStatus === FRIENDSHIP_STATUS_REJECTED ? "Rejected" : "Pending"}</span>
      `;
    }
  }
  if (creditTitleEl) {
    creditTitleEl.textContent =
      friendshipStatus === FRIENDSHIP_STATUS_PENDING_OUTGOING ||
      friendshipStatus === FRIENDSHIP_STATUS_PENDING_INCOMING
        ? "Suggested credit limit"
        : "Credit limit";
  }
  if (creditAmountEl) {
    const creditLimit = connection?.trust_credit_limit_eur ?? 0;
    creditAmountEl.textContent = formatCurrency(creditLimit);
  }
  if (
    creditButton &&
    friendId &&
    (friendshipStatus === FRIENDSHIP_STATUS_ACCEPTED ||
      friendshipStatus === FRIENDSHIP_STATUS_PENDING_OUTGOING)
  ) {
    creditButton.addEventListener("click", () => {
      window.location.hash = `credit/${friendId}`;
    });
  } else if (creditButton) {
    creditButton.classList.add("friend-stat--disabled");
    creditButton.setAttribute("aria-disabled", "true");
  }
  const debt = connection?.debt_eur || 0;
  if (debtLabelEl) {
    if (isAcceptedFriendshipStatus(friendshipStatus)) {
      debtLabelEl.textContent = debt >= 0 ? "owes you" : "you owe";
    } else {
      debtLabelEl.textContent = "Friendship";
    }
  }
  if (debtAmountEl) {
    if (isAcceptedFriendshipStatus(friendshipStatus)) {
      debtAmountEl.textContent = formatSigned(debt);
      debtAmountEl.classList.toggle("pos", debt >= 0);
      debtAmountEl.classList.toggle("neg", debt < 0);
    } else {
      const statusText =
        friendshipStatus === FRIENDSHIP_STATUS_PENDING_INCOMING
          ? "Incoming"
          : friendshipStatus === FRIENDSHIP_STATUS_REJECTED
          ? "Rejected"
          : "Pending";
      debtAmountEl.textContent = statusText;
      debtAmountEl.classList.remove("pos", "neg");
    }
  }

  const acceptButton = headerRight?.querySelector('[data-action="accept-friend"]');
  if (acceptButton && friendId) {
    acceptButton.addEventListener("click", async () => {
      await acceptFriend(friendId);
    });
  }
  const rejectButton = headerRight?.querySelector('[data-action="reject-friend"]');
  if (rejectButton && friendId) {
    rejectButton.addEventListener("click", async () => {
      await rejectFriend(friendId);
    });
  }

  if (!bodyEl || !listEl || !txTemplate) return;
  listEl.innerHTML = "";

  if (!isAcceptedFriendshipStatus(friendshipStatus)) {
    const statusBodyText =
      friendshipStatus === FRIENDSHIP_STATUS_PENDING_INCOMING
        ? "This friend request is waiting for your decision."
        : friendshipStatus === FRIENDSHIP_STATUS_REJECTED
        ? "This friendship request has been rejected."
        : "This friend request is pending until the other user accepts it.";
    bodyEl.innerHTML = `<div class="empty">${statusBodyText}</div>`;
    return;
  }

  const transactions = Array.isArray(connection?.recent_transactions)
    ? connection.recent_transactions
    : [];

  if (!transactions.length) {
    bodyEl.innerHTML = `<div class="empty">No transactions yet.</div>`;
    return;
  }

  transactions.forEach((tx) => {
    const txNode = txTemplate.content.firstElementChild.cloneNode(true);
    const dateEl = txNode.querySelector('[data-bind="date"]');
    const amountTxEl = txNode.querySelector('[data-bind="amount"]');
    const noteEl = txNode.querySelector('[data-bind="note"]');
    if (dateEl) dateEl.textContent = formatDate(tx.date);
    if (amountTxEl) amountTxEl.textContent = formatSigned(tx.amount_eur);
    if (noteEl) noteEl.textContent = tx.note;
    listEl.appendChild(txNode);
  });
};
