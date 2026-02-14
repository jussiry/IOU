import { resetState } from "../data.js";

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
