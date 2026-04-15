/*
This module defines the core persisted data model for the IOU client. It provides factory helpers for users, contacts, connections, and log entries so IndexedDB state stays structurally consistent.

The same helpers are used for normalization when loading persisted state. Keeping model defaults in one place makes storage migrations safer and prevents repeated shape checks across UI modules.
*/

import { FRIENDSHIP_STATUS_ACCEPTED } from "../utils/friendships.js";

export const DATA_MODEL_VERSION = 3;

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

const clonePlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
};

const normalizeStringList = (values) => {
  if (!Array.isArray(values)) return [];

  const normalizedValues = new Set();
  values.forEach((value) => {
    const normalizedValue = asTrimmedStringOrDefault(value);
    if (!normalizedValue) return;
    normalizedValues.add(normalizedValue);
  });

  return Array.from(normalizedValues);
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
    friendship_status: asTrimmedStringOrDefault(
      input.friendship_status,
      FRIENDSHIP_STATUS_ACCEPTED
    ),
    debt_eur: asNumberOrDefault(input.debt_eur, 0),
    trust_credit_limit_eur: asNumberOrDefault(input.trust_credit_limit_eur, 0),
    pending_credit_limit_eur: Number.isFinite(input.pending_credit_limit_eur) && input.pending_credit_limit_eur >= 0
      ? input.pending_credit_limit_eur
      : null,
    pending_credit_limit_is_incoming: input.pending_credit_limit_is_incoming === true
      ? true
      : input.pending_credit_limit_is_incoming === false
      ? false
      : input.pending_credit_limit_is_incoming === "lowered"
      ? "lowered"
      : null,
    recent_transactions: transactions,
    last_synced_at: asTrimmedStringOrDefault(input.last_synced_at),
    pending_payment_request: input.pending_payment_request && typeof input.pending_payment_request === "object"
      ? {
          id: asTrimmedStringOrDefault(input.pending_payment_request.id),
          amount_eur: asNumberOrDefault(input.pending_payment_request.amount_eur, 0),
          note: asTrimmedStringOrDefault(input.pending_payment_request.note),
          is_incoming: input.pending_payment_request.is_incoming === true,
          created_at: asTrimmedStringOrDefault(input.pending_payment_request.created_at),
        }
      : null,
    pending_name_change: input.pending_name_change &&
      typeof input.pending_name_change.oldName === "string" &&
      typeof input.pending_name_change.newName === "string"
      ? { oldName: input.pending_name_change.oldName, newName: input.pending_name_change.newName }
      : null,
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

export const createLedgerEntryModel = (input = {}) => {
  return {
    id: asTrimmedStringOrDefault(input.id),
    timestamp: asTrimmedStringOrDefault(input.timestamp),
    type: asTrimmedStringOrDefault(input.type),
    from_user_id: asTrimmedStringOrDefault(input.from_user_id),
    to_user_id: asTrimmedStringOrDefault(input.to_user_id),
    // Sender's asserted timestamp from the peer message's created_at. Kept
    // alongside the locally-authoritative `timestamp` so the signed digest can
    // be reconstructed and verified after the fact.
    originated_at: asTrimmedStringOrDefault(input.originated_at),
    // Schnorr signature (hex) over the canonical inner-message digest.
    // Present on entries that originated from peer messages; may be empty for
    // legacy data where no signature was produced.
    signature: asTrimmedStringOrDefault(input.signature),
    payload: clonePlainObject(input.payload),
  };
};

export const createPeerMessageModel = (input = {}) => {
  return {
    id: asTrimmedStringOrDefault(input.id),
    type: asTrimmedStringOrDefault(input.type),
    from_user_id: asTrimmedStringOrDefault(input.from_user_id),
    to_user_id: asTrimmedStringOrDefault(input.to_user_id),
    created_at: asTrimmedStringOrDefault(input.created_at),
    signature: asTrimmedStringOrDefault(input.signature),
    payload: clonePlainObject(input.payload),
  };
};

export const createEmptyAppState = (userPerson) => {
  return {
    model_version: DATA_MODEL_VERSION,
    user: createPersonModel(userPerson),
    contacts: {},
    ledger: [],
    outbox: [],
    processed_peer_message_ids: [],
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
    model_version: DATA_MODEL_VERSION,
    user: createPersonModel(state.user),
    contacts: normalizeContactsMap(state.contacts),
    ledger: Array.isArray(state.ledger) ? state.ledger.map((entry) => createLedgerEntryModel(entry)) : [],
    outbox: Array.isArray(state.outbox)
      ? state.outbox.map((entry) => createPeerMessageModel(entry))
      : [],
    processed_peer_message_ids: normalizeStringList(state.processed_peer_message_ids),
  };
};
