/*
This module binds a reusable check-toggle control. It centralizes pressed-state handling so pages can react to on/off changes without duplicating toggle DOM logic.

The component expects a button element that already contains the visual track and thumb markup. It updates `aria-pressed`, syncs the active class, and reports changes through a callback.
@category ui
*/

const setToggleState = (button, isChecked) => {
  if (!button) return;
  button.classList.toggle("is-active", isChecked);
  button.setAttribute("aria-pressed", String(isChecked));
};

export const initCheckToggle = (button, options = {}) => {
  if (!button) {
    return {
      isChecked: () => false,
      setChecked: () => {},
    };
  }

  const { checked = false, onChange = null } = options;
  let isChecked = Boolean(checked);

  const applyState = (nextChecked) => {
    isChecked = Boolean(nextChecked);
    setToggleState(button, isChecked);
    if (typeof onChange === "function") {
      onChange(isChecked);
    }
  };

  button.addEventListener("click", () => {
    applyState(!isChecked);
  });

  applyState(isChecked);

  return {
    isChecked: () => isChecked,
    setChecked: applyState,
  };
};
