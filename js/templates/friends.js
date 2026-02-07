import { formatSigned } from "../utils/format.js";

export const bindFriends = (root, data) => {
  const listContainer = root.querySelector('[data-list="friends"]');
  const friendTemplate = root.querySelector('[data-template="friend-item"]');
  if (!listContainer || !friendTemplate) return;

  listContainer.innerHTML = "";

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
      amountEl.textContent = formatSigned(connection.debt_eur);
      amountEl.classList.add(connection.debt_eur >= 0 ? "pos" : "neg");
    }

    listContainer.appendChild(node);
  });
};
