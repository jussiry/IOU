/*
This module defines the core persisted data model for the IOU client. It provides factory helpers for users, contacts, connections, and log entries so IndexedDB state stays structurally consistent.

The same helpers are used for normalization when loading persisted state. Keeping model defaults in one place makes storage migrations safer and prevents repeated shape checks across UI modules.
*/

export const DATA_MODEL_VERSION = 1;

const asNumberOrDefault = (value, defaultValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : defaultValue;
};

const asStringOrDefault = (value, defaultValue = "") => {
  return typeof value === "string" ? value : defaultValue;
};

export const createTransactionModel = (input = {}) => {
  return {
    id: asStringOrDefault(input.id),
    date: asStringOrDefault(input.date),
    amount_eur: asNumberOrDefault(input.amount_eur, 0),
    note: asStringOrDefault(input.note),
  };
};

export const createConnectionModel = (input = {}) => {
  const transactions = Array.isArray(input.recent_transactions)
    ? input.recent_transactions.map((transaction) => createTransactionModel(transaction))
    : [];

  return {
    person_id: asStringOrDefault(input.person_id),
    person_name: asStringOrDefault(input.person_name),
    debt_eur: asNumberOrDefault(input.debt_eur, 0),
    trust_credit_limit_eur: asNumberOrDefault(input.trust_credit_limit_eur, 0),
    recent_transactions: transactions,
  };
};

export const createPersonModel = (input = {}) => {
  const normalizedName = asStringOrDefault(input.name).trim();
  const normalizedPublicKey = asStringOrDefault(input.public_key).trim();
  const personId = asStringOrDefault(input.id).trim() || normalizedPublicKey;
  const connections = Array.isArray(input.connections)
    ? input.connections.map((connection) => createConnectionModel(connection))
    : [];

  return {
    id: personId,
    name: normalizedName || "Anonymous",
    public_key: normalizedPublicKey || personId,
    public_key_hex: asStringOrDefault(input.public_key_hex),
    private_key: asStringOrDefault(input.private_key),
    private_key_hex: asStringOrDefault(input.private_key_hex),
    connections,
  };
};

export const createLogEntryModel = (input = {}) => {
  return {
    id: asStringOrDefault(input.id),
    transaction_id: asStringOrDefault(input.transaction_id),
    timestamp: asStringOrDefault(input.timestamp),
    text: asStringOrDefault(input.text),
    message: asStringOrDefault(input.message),
    friend_id: asStringOrDefault(input.friend_id),
    amount_eur: asNumberOrDefault(input.amount_eur, 0),
  };
};

export const createEmptyAppState = (userPerson) => {
  return {
    model_version: DATA_MODEL_VERSION,
    user: createPersonModel(userPerson),
    contacts: {},
    logs: [],
  };
};

export const normalizeContactsMap = (contacts) => {
  if (!contacts || typeof contacts !== "object") return {};

  return Object.entries(contacts).reduce((normalizedContacts, [contactKey, contactValue]) => {
    const normalizedContact = createPersonModel({
      ...contactValue,
      id: contactValue?.id || contactKey,
      public_key: contactValue?.public_key || contactKey,
    });
    if (!normalizedContact.id) return normalizedContacts;
    normalizedContacts[normalizedContact.id] = normalizedContact;
    return normalizedContacts;
  }, {});
};

export const normalizeAppState = (state) => {
  if (!state || typeof state !== "object") return null;
  if (!state.user) return null;

  return {
    model_version: asNumberOrDefault(state.model_version, DATA_MODEL_VERSION),
    user: createPersonModel(state.user),
    contacts: normalizeContactsMap(state.contacts),
    logs: Array.isArray(state.logs) ? state.logs.map((entry) => createLogEntryModel(entry)) : [],
  };
};
