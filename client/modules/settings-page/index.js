/*
This module binds settings interactions for the app. It renders user/version metadata and wires actions for renaming the user and removing local app data.

By centralizing settings behavior here, the app shell only needs to pass data and version context without owning button logic.
*/

import { resetState, updateUserName } from "../../js/data.js";

export const bindSettings = (root, data, appVersion) => {
  const userNameEl = root.querySelector('[data-bind="user-name"]');
  const editNameButton = root.querySelector('[data-action="edit-user-name"]');
  if (userNameEl) {
    userNameEl.textContent = data?.you?.name || "You";
  }
  if (editNameButton) {
    editNameButton.addEventListener("click", async () => {
      const currentName = data?.you?.name || "";
      const nextName = window.prompt("Choose a name", currentName);
      if (nextName == null) return;
      await updateUserName(nextName);
      window.location.reload();
    });
  }

  const versionEl = root.querySelector('[data-bind="app-version"]');
  if (versionEl && appVersion) {
    versionEl.textContent = `Version ${appVersion}`;
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
