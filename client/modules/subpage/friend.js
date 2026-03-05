/*
This module binds the friend detail subpage. It renders debt/credit summary cards, injects friend-specific labels, and lists recent transactions.

It also exposes navigation triggers to related subpages by wiring the credit tile click target from the current friend context.
*/

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

  if (titleEl) titleEl.textContent = friendName;
  if (labelEl) labelEl.textContent = `My transactions with ${friendFirstName}`;
  if (headerRight) {
    headerRight.innerHTML = `
      <button class="friend-send surface-box" type="button" data-action="send" aria-label="Send IOU">
        <svg class="friend-send-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <use href="#icon-send" />
        </svg>
        <span class="friend-send-label">Send</span>
      </button>
    `;
  }
  if (creditTitleEl) creditTitleEl.textContent = "Credit limit";
  if (creditAmountEl) {
    const creditLimit = connection?.trust_credit_limit_eur ?? 0;
    creditAmountEl.textContent = formatCurrency(creditLimit);
  }
  if (creditButton && friendId) {
    creditButton.addEventListener("click", () => {
      window.location.hash = `credit/${friendId}`;
    });
  }
  const debt = connection?.debt_eur || 0;
  if (debtLabelEl) debtLabelEl.textContent = debt >= 0 ? "owes you" : "you owe";
  if (debtAmountEl) {
    debtAmountEl.textContent = formatSigned(debt);
    debtAmountEl.classList.toggle("pos", debt >= 0);
    debtAmountEl.classList.toggle("neg", debt < 0);
  }

  if (!bodyEl || !listEl || !txTemplate) return;
  listEl.innerHTML = "";

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
