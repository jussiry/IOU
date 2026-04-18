/*
This module binds settings interactions for the app. It renders user/version metadata and wires actions for renaming the user and removing local app data.

By centralizing settings behavior here, the app shell only needs to pass data and version context without owning button logic.
*/

import { resetState } from "../../js/app-state.js";
import { updateUserName } from "../../js/commands/user.js";

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
    const isConfirmed = window.confirm(
      "Are you totally sure? This will permanently remove all your data in this application?"
    );
    if (!isConfirmed) return;
    await resetState();
    window.location.hash = "welcome";
    window.location.reload();
  });
};
