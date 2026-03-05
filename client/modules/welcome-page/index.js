/*
This module binds the first-run welcome screen. It validates the initial username, handles submit state, and delegates user creation to the app shell callback.

By containing the welcome form behavior here, the router only needs to provide a create-user action and can keep route orchestration independent from UI input details.
*/

export const bindWelcome = (root, { onCreateUser } = {}) => {
  const formElement = root.querySelector('[data-form="welcome"]');
  const nameInput = root.querySelector('[data-bind="welcome-name"]');
  const errorElement = root.querySelector('[data-bind="welcome-error"]');
  const createButton = root.querySelector('[data-action="create-user"]');

  if (!formElement || !nameInput || !createButton || typeof onCreateUser !== "function") {
    return;
  }

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

    try {
      setBusy(true);
      await onCreateUser(enteredName);
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
