import { formatDate, formatSigned } from "../../utils/format.js";

export const bindFriendDetail = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const labelEl = root.querySelector('[data-bind="friend-label"]');
  const headerRight = root.querySelector('[data-slot="subpage-header-right"]');
  const bodyEl = root.querySelector('[data-section="friend-body"]');
  const listEl = root.querySelector('[data-list="friend-transactions"]');
  const txTemplate = root.querySelector('[data-template="tx-item"]');

  const connection = data.connections.find((entry) => entry.person_id === friendId);
  const friendName = connection?.person_name || "Friend";
  const friendFirstName = friendName.split(/\s+/)[0] || friendName;

  if (titleEl) titleEl.textContent = friendName;
  if (labelEl) labelEl.textContent = `My transactions with ${friendFirstName}`;
  if (headerRight) {
    const debt = connection?.debt_eur || 0;
    const label = debt >= 0 ? "owes you" : "you owe";
    headerRight.innerHTML = `
      <div class="friend-amount">
        <span class="friend-amount-label">${label}</span>
        ${formatSigned(debt)}
      </div>
    `;
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
