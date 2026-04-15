/*
Shared state utilities used across the data layer modules.

These small helpers are extracted to avoid circular dependencies between
data.js, peer-outbox.js, connection-helpers.js, and peer-message-handlers.js.
*/

import { createLedgerEntryModel } from "./models/data-model.js";

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

export const appendLedgerEntry = (
  state,
  { id, type, fromUserId, toUserId, payload = {}, signature = "", originatedAt = "" } = {}
) => {
  state.ledger = Array.isArray(state.ledger) ? state.ledger : [];
  state.ledger.unshift(
    createLedgerEntryModel({
      id: id || createId("ledger"),
      timestamp: new Date().toISOString(),
      type,
      from_user_id: fromUserId || "",
      to_user_id: toUserId || "",
      signature,
      originated_at: originatedAt,
      payload,
    })
  );
};
