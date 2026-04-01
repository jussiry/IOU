/*
This module binds the first-run welcome screen. It validates the initial username, optionally accepts an existing private key, handles submit state, and delegates user creation to the app shell callback.

By containing the welcome form behavior here, the router only needs to provide a create-user action and can keep route orchestration independent from UI input details.
*/

import { initCheckToggle } from "../components/check-toggle.js";
import { isValidNsec } from "../../js/utils/nostr-keys.js";

export const bindWelcome = (root, { onCreateUser } = {}) => {
  const formElement = root.querySelector('[data-form="welcome"]');
  const nameInput = root.querySelector('[data-bind="welcome-name"]');
  const errorElement = root.querySelector('[data-bind="welcome-error"]');
  const createButton = root.querySelector('[data-action="create-user"]');
  const toggleButton = root.querySelector('[data-bind="existing-key-toggle"]');
  const keyPanel = root.querySelector('[data-section="existing-key-panel"]');
  const privateKeyInput = root.querySelector('[data-bind="private-key-input"]');

  if (!formElement || !nameInput || !createButton || typeof onCreateUser !== "function") {
    return;
  }

  const toggle = initCheckToggle(toggleButton, {
    checked: false,
    onChange: (isChecked) => {
      if (keyPanel) keyPanel.hidden = !isChecked;
      if (isChecked && privateKeyInput) {
        setTimeout(() => privateKeyInput.focus(), 0);
      }
    },
  });

  const setError = (message) => {
    if (!errorElement) return;
    if (!message) {
      errorElement.textContent = "";
      errorElement.hidden = true;
      return;
    }

    errorElement.textContent = message;
    errorElement.hidden = false;
  };

  const setBusy = (isBusy) => {
    createButton.disabled = isBusy;
    createButton.textContent = isBusy ? "Creating user..." : "Create a user";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const enteredName = nameInput.value.trim();
    if (!enteredName) {
      setError("Please choose a name before continuing.");
      nameInput.focus();
      return;
    }

    let existingNsec = null;
    if (toggle.isChecked()) {
      const keyValue = privateKeyInput ? privateKeyInput.value.trim() : "";
      if (!keyValue) {
        setError("Please enter your private key.");
        if (privateKeyInput) privateKeyInput.focus();
        return;
      }
      if (!isValidNsec(keyValue)) {
        setError("Invalid private key. Expected format: nsec1...");
        if (privateKeyInput) privateKeyInput.focus();
        return;
      }
      existingNsec = keyValue;
    }

    try {
      setBusy(true);
      await onCreateUser(enteredName, { existingNsec });
    } catch (error) {
      setError("Could not create user. Please try again.");
      setBusy(false);
    }
  };

  formElement.addEventListener("submit", (event) => {
    void handleSubmit(event);
  });

  setTimeout(() => {
    nameInput.focus();
  }, 0);
};
