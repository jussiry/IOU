export const bindSend = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const selectEl = root.querySelector('[data-bind="send-to"]');
  const explainerEl = root.querySelector('[data-bind="send-explainer"]');
  const amountEl = root.querySelector('[data-bind="send-amount"]');
  const messageEl = root.querySelector('[data-bind="send-message"]');
  const submitEl = root.querySelector('[data-bind="send-submit"]');

  if (titleEl) titleEl.textContent = "Send IOU";

  const getFirstName = (fullName) => fullName.split(/\s+/)[0] || fullName;

  const updateExplainer = (name, alternate) => {
    if (!explainerEl) return;
    const friendName = name ? getFirstName(name) : "your friend";
    const otherName = alternate ? getFirstName(alternate) : "another friend";
    explainerEl.innerHTML = `
      <p>When sending IOU's (I Owe You) you are making a promise of giving something of that value to that person sometime later.</p>
      <p>This transaction can be redeemed by your friend sending their IOU's back to you. IOU's can also be redeemed in circular cancellation: <strong>you</strong> owe <strong>${friendName}</strong> who owes <strong>${otherName}</strong> who owes <strong>you</strong>. Circular cancellations are made automatically by the system.</p>
    `;
  };

  if (selectEl) {
    selectEl.innerHTML = "";
    const sorted = [...data.connections].sort((a, b) => {
      const nameA = a.person_name || a.person_id || "";
      const nameB = b.person_name || b.person_id || "";
      return nameA.localeCompare(nameB);
    });

    sorted.forEach((connection) => {
      const option = document.createElement("option");
      option.value = connection.person_id;
      option.textContent = connection.person_name || connection.person_id;
      selectEl.appendChild(option);
    });

    if (friendId) {
      selectEl.value = friendId;
    }

    const selectAlternate = (currentId) => {
      const candidates = sorted.filter((connection) => connection.person_id !== currentId);
      if (!candidates.length) return null;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return pick?.person_name || pick?.person_id || null;
    };

    const selected = sorted.find((connection) => connection.person_id === selectEl.value);
    const selectedName = selected?.person_name || selected?.person_id;
    updateExplainer(selectedName, selectAlternate(selectEl.value));

    selectEl.addEventListener("change", () => {
      const current = sorted.find((connection) => connection.person_id === selectEl.value);
      const name = current?.person_name || current?.person_id;
      updateExplainer(name, selectAlternate(selectEl.value));
    });
  } else {
    updateExplainer(null, null);
  }

  return {
    submitEl,
    getPayload: () => {
      const selectedId = selectEl?.value || friendId;
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
