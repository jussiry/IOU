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

const closeDetail = (detail, wrap) => {
  if (!wrap || !detail.hasAttribute("open")) return;
  wrap.style.height = `${wrap.getBoundingClientRect().height}px`;
  requestAnimationFrame(() => {
    wrap.style.height = "0px";
    wrap.style.opacity = "0";
  });
  const onEnd = (event) => {
    if (event.propertyName !== "height") return;
    detail.removeAttribute("open");
    wrap.removeEventListener("transitionend", onEnd);
  };
  wrap.addEventListener("transitionend", onEnd);
};

const openDetail = (detail, wrap) => {
  if (!wrap || detail.hasAttribute("open")) return;
  detail.setAttribute("open", "");
  wrap.style.height = "0px";
  wrap.style.opacity = "0";
  requestAnimationFrame(() => {
    wrap.style.height = `${wrap.scrollHeight}px`;
    wrap.style.opacity = "1";
  });
  const onEnd = (event) => {
    if (event.propertyName !== "height") return;
    wrap.style.height = `${wrap.scrollHeight}px`;
    wrap.removeEventListener("transitionend", onEnd);
  };
  wrap.addEventListener("transitionend", onEnd);
};

export const setActiveNav = (navButtons, page) => {
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
  const toggleButtons = Array.from(root.querySelectorAll(".pill.toggle"));
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
};

export const initAccordion = (root) => {
  const containers = Array.from(root.querySelectorAll(".accordion"));
  containers.forEach((container) => {
    const friendDetails = Array.from(container.querySelectorAll(".friend"));
    friendDetails.forEach((detail) => {
      const summary = detail.querySelector("summary");
      const wrap = detail.querySelector(".tx-wrap");
      if (!summary || !wrap) return;

      summary.addEventListener("click", (event) => {
        event.preventDefault();
        const isOpen = detail.hasAttribute("open");
        friendDetails.forEach((other) => {
          if (other === detail) return;
          closeDetail(other, other.querySelector(".tx-wrap"));
        });
        if (isOpen) {
          closeDetail(detail, wrap);
        } else {
          openDetail(detail, wrap);
        }
      });
    });
  });
};

const renderInlineList = (root, list, templateSelector) => {
  const container = root.querySelector(templateSelector.list);
  if (!container) return;
  container.innerHTML = "";

  const template = root.querySelector(templateSelector.template);
  if (!template) return;

  list.forEach((entry) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const nameEl = node.querySelector('[data-bind="name"]');
    const amountEl = node.querySelector('[data-bind="amount"]');
    if (nameEl) nameEl.textContent = entry.name;
    if (amountEl) {
      amountEl.textContent = formatSigned(entry.debt_eur);
      amountEl.classList.add(entry.debt_eur >= 0 ? "pos" : "neg");
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
  root.querySelector('[data-bind="total-credit"]').textContent = formatCurrency(
    data.totals.totalCredit
  );

  const friendsOwe = data.connections
    .filter((connection) => connection.debt_eur > 0)
    .sort((a, b) => b.debt_eur - a.debt_eur);

  const youOwe = data.connections
    .filter((connection) => connection.debt_eur < 0)
    .sort((a, b) => Math.abs(b.debt_eur) - Math.abs(a.debt_eur));

  renderInlineList(root, friendsOwe, {
    list: '[data-list="friends-owe"]',
    template: '[data-template="inline-item"]',
  });
  renderInlineList(root, youOwe, {
    list: '[data-list="you-owe"]',
    template: '[data-template="inline-item"]',
  });
};

export const bindFriends = (root, data) => {
  const listContainer = root.querySelector('[data-list="friends"]');
  const friendTemplate = root.querySelector('[data-template="friend-item"]');
  const txTemplate = root.querySelector('[data-template="tx-item"]');
  if (!listContainer || !friendTemplate || !txTemplate) return;

  listContainer.innerHTML = "";

  const sortedConnections = [...data.connections].sort(
    (a, b) => Math.abs(b.debt_eur) - Math.abs(a.debt_eur)
  );

  sortedConnections.forEach((connection) => {
    const node = friendTemplate.content.firstElementChild.cloneNode(true);
    const nameEl = node.querySelector('[data-bind="name"]');
    const badgeEl = node.querySelector('[data-bind="badge"]');
    const amountEl = node.querySelector('[data-bind="amount"]');
    if (nameEl) nameEl.textContent = connection.person_name || connection.person_id;
    if (badgeEl) badgeEl.textContent = connection.debt_eur >= 0 ? "owes you" : "you owe";
    if (amountEl) {
      amountEl.textContent = formatSigned(connection.debt_eur);
      amountEl.classList.add(connection.debt_eur >= 0 ? "pos" : "neg");
    }

    const txList = node.querySelector('[data-list="transactions"]');
    const transactions = Array.isArray(connection.recent_transactions)
      ? connection.recent_transactions
      : [];
    transactions.forEach((tx) => {
      const txNode = txTemplate.content.firstElementChild.cloneNode(true);
      const dateEl = txNode.querySelector('[data-bind="date"]');
      const amountTxEl = txNode.querySelector('[data-bind="amount"]');
      const noteEl = txNode.querySelector('[data-bind="note"]');
      if (dateEl) dateEl.textContent = formatDate(tx.date);
      if (amountTxEl) amountTxEl.textContent = formatSigned(tx.amount_eur);
      if (noteEl) noteEl.textContent = tx.note;
      txList.appendChild(txNode);
    });

    listContainer.appendChild(node);
  });
};
