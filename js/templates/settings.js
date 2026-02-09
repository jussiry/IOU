import { resetState } from "../data.js";

export const bindSettings = (root) => {
  const resetButton = root.querySelector('[data-action="reset-state"]');
  if (!resetButton) return;
  resetButton.addEventListener("click", () => {
    resetState();
    window.location.reload();
  });
};
