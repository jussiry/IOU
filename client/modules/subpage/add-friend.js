/*
This module binds the add-friend subpage. It manages the public-key form, the self-key copy field, the credit-limit toggle, and the dynamic visibility of the optional credit-limit input.

It keeps the add-friend form state local to the page, validates the entered public key, and handles lightweight clipboard/select interactions so routing code can handle persistence and navigation without duplicating DOM queries.
*/

import { initCheckToggle } from "../components/check-toggle.js";
import { isValidNpub } from "../../js/utils/nostr-keys.js";

const selectInputText = (inputEl) => {
  if (!inputEl) {
    return;
  }

  inputEl.focus();
  inputEl.select();
  if (typeof inputEl.setSelectionRange === "function") {
    inputEl.setSelectionRange(0, inputEl.value.length);
  }
};

const copyTextToClipboard = async (text, inputEl) => {
  const normalizedText = typeof text === "string" ? text : "";
  if (!normalizedText) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalizedText);
      return true;
    }
  } catch {
    // fall through to selection-based copy
  }

  selectInputText(inputEl);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
};

export const bindAddFriend = (root, data) => {
  const titleEl = root.querySelector('[data-bind="page-title"]');
  const myKeyEl = root.querySelector('[data-bind="my-key"]');
  const copyMyKeyButtonEl = root.querySelector('[data-action="copy-my-key"]');
  const friendKeyEl = root.querySelector('[data-bind="friend-key"]');
  const friendKeyErrorEl = root.querySelector('[data-bind="friend-key-error"]');
  const toggleEl = root.querySelector('[data-bind="suggest-credit-toggle"]');
  const creditPanelEl = root.querySelector('[data-section="suggest-credit-panel"]');
  const creditExplainerEl = root.querySelector('[data-section="suggest-credit-explainer"]');
  const creditLimitEl = root.querySelector('[data-bind="credit-limit"]');
  const submitEl = root.querySelector('[data-bind="add-friend-submit"]');
  const userPublicKey = data?.you?.id || "";
  let hasAttemptedInvalidSubmit = false;

  if (titleEl) {
    titleEl.textContent = "Add a friend";
  }
  if (myKeyEl) {
    myKeyEl.value = userPublicKey;
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

  myKeyEl?.addEventListener("click", () => {
    selectInputText(myKeyEl);
  });
  myKeyEl?.addEventListener("focus", () => {
    selectInputText(myKeyEl);
  });
  copyMyKeyButtonEl?.addEventListener("click", async () => {
    await copyTextToClipboard(userPublicKey, myKeyEl);
    selectInputText(myKeyEl);
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
