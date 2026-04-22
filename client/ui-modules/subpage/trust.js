/*
This module binds the trust-agreement subpage. It initializes form defaults from the selected friend connection and updates copy for create vs change flows.

It returns key form elements to the caller so submit behavior can be handled by higher-level routing logic.
*/

export const bindTrust = (root, data, friendId) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const limitInput = root.querySelector('[data-bind="trust-limit"]');
  const submitEl = root.querySelector('[data-bind="trust-submit"]');
  const submitLabelEl = root.querySelector('[data-bind="trust-submit-label"]');

  const friend = data.friends.find((entry) => entry.person_id === friendId);
  const friendName = friend?.person_name || "Friend";
  const trustLimit = friend?.trust_credit_limit_eur ?? 0;
  const hasAgreement = trustLimit > 0;

  if (titleEl) {
    titleEl.textContent = `Trust agreement with ${friendName}`;
  }

  if (limitInput) {
    limitInput.value = trustLimit ? trustLimit.toFixed(2) : "";
  }

  if (submitLabelEl) {
    submitLabelEl.textContent = hasAgreement ? "Change" : "Suggest";
  }

  return { submitEl, limitInput };
};
