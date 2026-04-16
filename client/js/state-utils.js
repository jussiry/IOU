/*
Shared state utilities used across the data layer modules.

These small helpers are extracted to avoid circular dependencies between
app-state.js, peer/outbox.js, connection-helpers.js, and peer/handlers.js.
Ledger-specific helpers live in `ledger.js`.
*/

export const hasUser = (state) => {
  return Boolean(
    state?.user?.id &&
      state?.user?.public_key &&
      state.user.id === state.user.public_key
  );
};

export const asTrimmedString = (value) => {
  return typeof value === "string" ? value.trim() : "";
};

export const createId = (prefix = "tx") => {
  if (window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }

  const randomToken = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${randomToken}`;
};
