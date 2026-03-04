/*
This module binds settings interactions for the app. It renders the current app version and wires the reset action used to clear local test state.

By centralizing settings behavior here, the app shell only needs to pass data and version context without owning button logic.
*/

import { resetState } from "../../js/data.js";

export const bindSettings = (root, data, appVersion) => {
  const versionEl = root.querySelector('[data-bind="app-version"]');
  if (versionEl && appVersion) {
    versionEl.textContent = `Version ${appVersion}`;
  }
  const resetButton = root.querySelector('[data-action="reset-state"]');
  if (!resetButton) return;
  resetButton.addEventListener("click", () => {
    resetState();
    window.location.reload();
  });
};
