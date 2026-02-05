const formatCurrency = (value) => `€${Math.abs(value).toFixed(2)}`;
const formatSigned = (value) =>
  value >= 0 ? `+€${value.toFixed(2)}` : `−€${Math.abs(value).toFixed(2)}`;
const formatNet = (value) =>
  value < 0 ? `−€${Math.abs(value).toFixed(2)}` : `€${value.toFixed(2)}`;

const formatDate = (isoDate) => {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleString("en-US", { month: "short", day: "numeric" });
};

const formatCreditUsage = (used, limit) => {
  if (used <= 0) {
    return `${formatCurrency(limit)}`;
  }
  return `<span class="used-of">${formatCurrency(used)}</span> <span class="used-of">used of</span> ${formatCurrency(limit)}`;
};

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
  root.querySelector('[data-bind="credit-from-others"]').textContent = formatCurrency(
    data.totals.creditFromOthers
  );
  root.querySelector('[data-bind="credit-you-extend"]').textContent = formatCurrency(
    data.totals.creditYouExtend
  );
  root.querySelector('[data-bind="available-credit"]').textContent = formatCurrency(
    data.totals.availableCredit
  );

  const friendsOwe = data.connections
    .filter((connection) => connection.debt_eur > 0)
    .sort((a, b) => b.debt_eur - a.debt_eur);

  const youOwe = data.connections
    .filter((connection) => connection.debt_eur < 0)
    .sort((a, b) => Math.abs(b.debt_eur) - Math.abs(a.debt_eur));

  renderInlineList(root, friendsOwe, {
    list: '[data-list="friends-owe"]',
    template: '[data-template="credit-item"]',
  });
  renderInlineList(root, youOwe, {
    list: '[data-list="you-owe"]',
    template: '[data-template="credit-item"]',
  });

  const creditFromOthers = data.connections
    .filter((connection) => (connection.inbound_credit_limit_eur || 0) > 0)
    .sort((a, b) => b.inbound_credit_limit_eur - a.inbound_credit_limit_eur);

  const creditYouExtend = data.connections
    .filter((connection) => (connection.trust_credit_limit_eur || 0) > 0)
    .sort((a, b) => b.trust_credit_limit_eur - a.trust_credit_limit_eur);

  renderInlineList(
    root,
    creditFromOthers,
    {
      list: '[data-list="credit-from-others"]',
      template: '[data-template="credit-item"]',
    },
    {
      formatAmount: (entry) => {
        const limit = entry.inbound_credit_limit_eur || 0;
        const used = Math.max(entry.debt_eur || 0, 0);
        return formatCreditUsage(used, limit);
      },
      amountAsHtml: true,
      skipSignClass: true,
    }
  );
  renderInlineList(
    root,
    creditYouExtend,
    {
      list: '[data-list="credit-you-extend"]',
      template: '[data-template="credit-item"]',
    },
    {
      formatAmount: (entry) => {
        const limit = entry.trust_credit_limit_eur || 0;
        const used = Math.max(-(entry.debt_eur || 0), 0);
        return formatCreditUsage(used, limit);
      },
      amountAsHtml: true,
      skipSignClass: true,
    }
  );
};

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

export const bindFriendDetail = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="subpage-title"]');
  const labelEl = root.querySelector('[data-bind="subpage-label"]');
  const amountEl = root.querySelector('[data-bind="subpage-amount"]');
  const bodyEl = root.querySelector('[data-section="subpage-body"]');
  const listEl = root.querySelector('[data-list="friend-transactions"]');
  const txTemplate = root.querySelector('[data-template="tx-item"]');

  const connection = data.connections.find((entry) => entry.person_id === friendId);
  const friendName = connection?.person_name || "Friend";
  const friendFirstName = friendName.split(/\s+/)[0] || friendName;

  if (titleEl) titleEl.textContent = friendName;
  if (labelEl) labelEl.textContent = `My transactions with ${friendFirstName}`;
  if (amountEl) {
    const debt = connection?.debt_eur || 0;
    const label = debt >= 0 ? "owes you" : "you owe";
    amountEl.innerHTML = `<span class="subpage-amount-label">${label}</span> ${formatSigned(debt)}`;
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
