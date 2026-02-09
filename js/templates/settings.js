import { APP_VERSION, resetState } from "../data.js";

export const bindSettings = (root) => {
  const versionEl = root.querySelector('[data-bind="app-version"]');
  if (versionEl) {
    versionEl.textContent = `Version ${APP_VERSION}`;
  }
  const resetButton = root.querySelector('[data-action="reset-state"]');
  if (!resetButton) return;
  resetButton.addEventListener("click", () => {
    resetState();
    window.location.reload();
  });
};
