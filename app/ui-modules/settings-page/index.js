/*
This module binds settings interactions for the app. It renders user/version metadata and wires actions for renaming the user and removing local app data.

By centralizing settings behavior here, the app shell only needs to pass data and version context without owning button logic.
*/

import { resetState } from "../../js/app-state.js";
import { updateUserName } from "../../js/commands/user.js";
import { addRelay, removeRelay, setShareMyRelays } from "../../js/commands/relays.js";
import { isAcceptedFriendshipStatus } from "../../js/utils/friendships.js";
import { formatCurrency } from "../../js/ui/format.js";
import { initCheckToggle } from "../components/check-toggle.js";
import { showConfirmModal } from "../components/confirm-modal.js";
import { isUpdateAvailable, applyUpdate } from "../../js/ui/app-update.js";

// Render the relay list inside the settings surface-box. Each row is cloned
// from the <template data-template="relay-item"> in the page HTML. The main
// relay is always first and renders without a remove button.
const ADD_RELAY_ERROR_MESSAGES = {
  invalid: "Enter a valid wss:// URL.",
  is_main: "This is already your main relay.",
  duplicate: "This relay is already in your list.",
  limit: "You've reached the maximum number of relays.",
};

const formatRelayUrlForDisplay = (url) => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
};

const renderRelayList = (root, relays, { onRemove }) => {
  const listEl = root.querySelector('[data-list="relay-list"]');
  const template = root.querySelector('[data-template="relay-item"]');
  if (!listEl || !template) return;

  listEl.innerHTML = "";
  const entries = Array.isArray(relays) ? relays : [];
  entries.forEach((relay) => {
    const fragment = template.content.cloneNode(true);
    const itemEl = fragment.querySelector(".relay-item");
    const statusEl = fragment.querySelector('[data-bind="status"]');
    const urlEl = fragment.querySelector('[data-bind="url"]');
    const removeEl = fragment.querySelector('[data-action="remove-relay"]');

    if (itemEl) {
      itemEl.classList.toggle("is-main", relay.is_main === true);
      itemEl.dataset.relayUrl = relay.url;
    }
    if (statusEl) {
      statusEl.classList.add(`relay-status-${relay.status || "pending"}`);
      statusEl.title =
        relay.status === "connected"
          ? "Connected"
          : relay.status === "pending"
          ? "Not connected yet"
          : "Disconnected";
    }
    if (urlEl) {
      urlEl.textContent = formatRelayUrlForDisplay(relay.url);
    }
    if (removeEl) {
      if (relay.is_main) {
        removeEl.hidden = true;
      } else {
        removeEl.addEventListener("click", () => onRemove(relay.url));
      }
    }

    listEl.appendChild(fragment);
  });
};

const bindRelaySection = (root, data) => {
  const formEl = root.querySelector('[data-form="add-relay"]');
  const openButtonEl = root.querySelector('[data-action="open-add-relay"]');
  const cancelButtonEl = root.querySelector('[data-action="cancel-add-relay"]');
  const inputEl = root.querySelector('[data-action="relay-url-input"]');
  const errorEl = root.querySelector('[data-bind="add-relay-error"]');

  const showError = (reason) => {
    if (!errorEl) return;
    const message = ADD_RELAY_ERROR_MESSAGES[reason] || "Couldn't add this relay.";
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = () => {
    if (!errorEl) return;
    errorEl.hidden = true;
    errorEl.textContent = "";
  };

  const openForm = () => {
    if (!formEl || !openButtonEl) return;
    clearError();
    if (inputEl) inputEl.value = "";
    formEl.hidden = false;
    openButtonEl.hidden = true;
    inputEl?.focus();
  };
  const closeForm = () => {
    if (!formEl || !openButtonEl) return;
    clearError();
    formEl.hidden = true;
    openButtonEl.hidden = false;
  };

  openButtonEl?.addEventListener("click", openForm);
  cancelButtonEl?.addEventListener("click", closeForm);
  inputEl?.addEventListener("input", clearError);

  formEl?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = inputEl?.value || "";
    const result = await addRelay(value);
    if (result?.ok) {
      closeForm();
    } else {
      showError(result?.reason || "invalid");
    }
  });

  renderRelayList(root, data?.relays, {
    onRemove: (url) => {
      void removeRelay(url);
    },
  });

  // "Tell friends what relays you use" toggle. Persists the flag now; the
  // actual `my_relays` peer-message exchange ships with the relay-pool
  // transport (TIP-003 §10).
  const shareToggleEl = root.querySelector('[data-bind="share-relays-toggle"]');
  if (shareToggleEl) {
    initCheckToggle(shareToggleEl, {
      checked: data?.shareMyRelays !== false,
      onChange: (isChecked) => {
        // Skip the initial sync call from initCheckToggle when the value
        // already matches what's persisted — avoids a redundant view rebuild.
        if (data?.shareMyRelays === isChecked) return;
        void setShareMyRelays(isChecked);
      },
    });
  }
};

export const bindSettings = (root, data, appVersion) => {
  const userNameEl = root.querySelector('[data-bind="user-name"]');
  const editNameButton = root.querySelector('[data-action="edit-user-name"]');
  if (userNameEl) {
    userNameEl.textContent = data?.you?.name || "You";
  }
  const nameView = root.querySelector("[data-name-view]");
  const nameEdit = root.querySelector("[data-name-edit]");
  const nameInput = root.querySelector("[data-action='name-input']");

  const enterEdit = () => {
    nameInput.value = data?.you?.name || "";
    nameView.hidden = true;
    if (editNameButton) editNameButton.hidden = true;
    nameEdit.hidden = false;
    nameInput.focus();
    nameInput.select();
  };

  const exitEdit = () => {
    nameEdit.hidden = true;
    nameView.hidden = false;
    if (editNameButton) editNameButton.hidden = false;
  };

  if (editNameButton) {
    editNameButton.addEventListener("click", enterEdit);
  }

  if (nameEdit) {
    nameEdit.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nextName = nameInput.value.trim();
      if (nextName) await updateUserName(nextName);
      exitEdit();
    });

    const cancelBtn = nameEdit.querySelector("[data-action='cancel-edit-name']");
    if (cancelBtn) cancelBtn.addEventListener("click", exitEdit);
  }

  bindRelaySection(root, data);

  // Update banner — only shown once the service worker has a new version
  // waiting. Clicking applies it (the worker activates and the page reloads).
  const updateBanner = root.querySelector('[data-bind="update-banner"]');
  if (updateBanner) {
    updateBanner.hidden = !isUpdateAvailable();
    const applyButton = updateBanner.querySelector('[data-action="apply-update"]');
    if (applyButton) applyButton.addEventListener("click", () => applyUpdate());
  }

  const versionEl = root.querySelector('[data-bind="app-version"]');
  if (versionEl && appVersion) {
    versionEl.textContent = `Version ${appVersion}`;
  }
  const transferButton = root.querySelector('[data-action="transfer-user"]');
  if (transferButton) {
    transferButton.addEventListener("click", () => {
      window.location.hash = "transfer";
    });
  }

  const removeUserButton = root.querySelector('[data-action="remove-user"]');
  if (!removeUserButton) return;
  removeUserButton.addEventListener("click", async () => {
    const friends = Array.isArray(data?.friends) ? data.friends : [];
    const unresolvedTallies = friends.filter(
      (friend) => isAcceptedFriendshipStatus(friend.friendship_status) && friend.debt_eur !== 0
    );
    const negativeTallies = unresolvedTallies.filter((friend) => friend.debt_eur < 0);

    let tallyWarning = "";
    if (unresolvedTallies.length > 0) {
      const lines = unresolvedTallies.map((friend) => {
        const amount = formatCurrency(friend.debt_eur);
        const direction = friend.debt_eur > 0 ? `owes you ${amount}` : `you owe ${amount}`;
        return `• ${friend.person_name}: ${direction}`;
      });
      tallyWarning = `\n\nUnresolved tallies:\n${lines.join("\n")}\n`;
      if (negativeTallies.length > 0) {
        const totalOwed = negativeTallies.reduce(
          (sum, friend) => sum + Math.abs(friend.debt_eur || 0),
          0
        );
        tallyWarning += `\nIf you have not transferred your user to another device, you are in practice defaulting on a tally totalling **${formatCurrency(totalOwed)}**. This can have serious consequences.\n`;
      }
    }

    const body = `This is a serious step. This will permanently remove all local data. Unless you have **transferred your user** to another device, your will not be able to retrieve your user.${tallyWarning}\nDo you still want to remove your user data?`;
    const isConfirmed = await showConfirmModal({
      title: "Remove user data",
      body,
      confirmLabel: "Remove",
    });
    if (!isConfirmed) return;
    await resetState();
    window.location.hash = "welcome";
    window.location.reload();
  });
};
