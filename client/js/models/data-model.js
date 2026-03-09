/*
This module defines the core persisted data model for the IOU client. It provides factory helpers for users, contacts, connections, and log entries so IndexedDB state stays structurally consistent.

The same helpers are used for normalization when loading persisted state. Keeping model defaults in one place makes storage migrations safer and prevents repeated shape checks across UI modules.
*/

export const DATA_MODEL_VERSION = 1;

const asNumberOrDefault = (value, defaultValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : defaultValue;
};

export const normalizeCurrencyAmount = (value, defaultValue = 0) => {
  return asNumberOrDefault(value, defaultValue);
};

const asStringOrDefault = (value, defaultValue = "") => {
  return typeof value === "string" ? value : defaultValue;
};

const asTrimmedStringOrDefault = (value, defaultValue = "") => {
  return asStringOrDefault(value, defaultValue).trim();
};

const normalizeConnectionList = (connections) => {
  if (!Array.isArray(connections)) return [];

  const normalizedConnections = new Map();
  connections.forEach((connection) => {
    const normalizedConnection = createConnectionModel(connection);
    if (!normalizedConnection.person_id) return;
    normalizedConnections.set(normalizedConnection.person_id, normalizedConnection);
  });

  return Array.from(normalizedConnections.values());
};

export const createTransactionModel = (input = {}) => {
  return {
    id: asTrimmedStringOrDefault(input.id),
    date: asTrimmedStringOrDefault(input.date),
    amount_eur: asNumberOrDefault(input.amount_eur, 0),
    note: asTrimmedStringOrDefault(input.note),
  };
};

export const createConnectionModel = (input = {}) => {
  const transactions = Array.isArray(input.recent_transactions)
    ? input.recent_transactions.map((transaction) => createTransactionModel(transaction))
    : [];

  return {
    person_id: asTrimmedStringOrDefault(input.person_id),
    person_name: asTrimmedStringOrDefault(input.person_name),
    debt_eur: asNumberOrDefault(input.debt_eur, 0),
    trust_credit_limit_eur: asNumberOrDefault(input.trust_credit_limit_eur, 0),
    recent_transactions: transactions,
  };
};

export const createPersonModel = (input = {}, options = {}) => {
  const { includePrivateKeys = true } = options;
  const normalizedName = asTrimmedStringOrDefault(input.name);
  const normalizedId = asTrimmedStringOrDefault(input.id);
  const normalizedPublicKey = asTrimmedStringOrDefault(input.public_key);
  const personId = normalizedPublicKey || normalizedId;
  const connections = normalizeConnectionList(input.connections);

  return {
    id: personId,
    name: normalizedName || "Anonymous",
    public_key: personId,
    public_key_hex: asTrimmedStringOrDefault(input.public_key_hex),
    private_key: includePrivateKeys
      ? asTrimmedStringOrDefault(input.private_key)
      : "",
    private_key_hex: includePrivateKeys
      ? asTrimmedStringOrDefault(input.private_key_hex)
      : "",
    connections,
  };
};

export const createPublicPersonModel = (input = {}) => {
  return createPersonModel(input, { includePrivateKeys: false });
};

export const createLogEntryModel = (input = {}) => {
  return {
    id: asTrimmedStringOrDefault(input.id),
    transaction_id: asTrimmedStringOrDefault(input.transaction_id),
    timestamp: asTrimmedStringOrDefault(input.timestamp),
    text: asTrimmedStringOrDefault(input.text),
    message: asTrimmedStringOrDefault(input.message),
    friend_id: asTrimmedStringOrDefault(input.friend_id),
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
    const normalizedContact = createPublicPersonModel({
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
