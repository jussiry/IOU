export const bindCredit = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const limitInput = root.querySelector('[data-bind="credit-limit"]');
  const submitEl = root.querySelector('[data-bind="credit-submit"]');
  const submitLabelEl = root.querySelector('[data-bind="credit-submit-label"]');

  const connection = data.connections.find((entry) => entry.person_id === friendId);
  const friendName = connection?.person_name || "Friend";
  const creditLimit = connection?.trust_credit_limit_eur ?? 0;
  const hasAgreement = creditLimit > 0;

  if (titleEl) {
    titleEl.textContent = hasAgreement
      ? `Change credit agreement with ${friendName}`
      : `Suggest credit agreement with ${friendName}`;
  }

  if (limitInput) {
    limitInput.value = creditLimit ? creditLimit.toFixed(2) : "";
  }

  if (submitLabelEl) {
    submitLabelEl.textContent = hasAgreement ? "Change" : "Suggest";
  }

  return { submitEl, limitInput };
};
