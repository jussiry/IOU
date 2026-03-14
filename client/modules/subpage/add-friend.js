/*
This module binds the add-friend subpage. It manages the public-key form, the credit-limit toggle, and the dynamic visibility of the optional credit-limit input.

It keeps the add-friend form state local to the page, validates the entered public key, and returns a compact payload reader so routing code can handle persistence and navigation without duplicating DOM queries.
*/

import { initCheckToggle } from "../components/check-toggle.js";
import { isValidNpub } from "../../js/utils/nostr-keys.js";

export const bindAddFriend = (root) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const friendKeyEl = root.querySelector('[data-bind="friend-key"]');
  const friendKeyErrorEl = root.querySelector('[data-bind="friend-key-error"]');
  const toggleEl = root.querySelector('[data-bind="suggest-credit-toggle"]');
  const creditPanelEl = root.querySelector('[data-section="suggest-credit-panel"]');
  const creditExplainerEl = root.querySelector('[data-section="suggest-credit-explainer"]');
  const creditLimitEl = root.querySelector('[data-bind="credit-limit"]');
  const submitEl = root.querySelector('[data-bind="add-friend-submit"]');
  let hasAttemptedInvalidSubmit = false;

  if (titleEl) {
    titleEl.textContent = "Add a friend";
  }

  const setFriendKeyErrorVisible = (isVisible) => {
    if (!friendKeyErrorEl) return;
    friendKeyErrorEl.hidden = !isVisible;
  };

  const syncSubmitState = () => {
    if (!submitEl) return;
    const isValid = isValidNpub(friendKeyEl?.value || "");
    submitEl.classList.toggle("is-disabled", !isValid);
    submitEl.setAttribute("aria-disabled", String(!isValid));
    setFriendKeyErrorVisible(!isValid && hasAttemptedInvalidSubmit);
  };

  const setCreditSuggestionEnabled = (isEnabled) => {
    if (creditPanelEl) {
      creditPanelEl.hidden = !isEnabled;
    }
    if (creditExplainerEl) {
      creditExplainerEl.hidden = !isEnabled;
    }
    if (isEnabled) {
      creditLimitEl?.focus();
    }
  };

  const creditToggle = initCheckToggle(toggleEl, {
    checked: false,
    onChange: setCreditSuggestionEnabled,
  });

  friendKeyEl?.addEventListener("input", syncSubmitState);
  submitEl?.addEventListener("click", (event) => {
    const isValid = isValidNpub(friendKeyEl?.value || "");
    if (isValid) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    hasAttemptedInvalidSubmit = true;
    syncSubmitState();
    friendKeyEl?.focus();
  });
  syncSubmitState();

  return {
    submitEl,
    getPayload: () => {
      const isSuggestingCredit = creditToggle.isChecked();
      const creditLimit = isSuggestingCredit ? parseFloat(creditLimitEl?.value || "") : NaN;
      const friendId = friendKeyEl?.value?.trim?.() || "";
      return {
        friendId: isValidNpub(friendId) ? friendId : "",
        creditLimit,
      };
    },
  };
};
