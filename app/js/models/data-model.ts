/*
This module defines the core persisted data model for the IOU client. It provides factory helpers for users, contacts, connections, and log entries so IndexedDB state stays structurally consistent.

The same helpers are used for normalization when loading persisted state. Keeping model defaults in one place makes storage migrations safer and prevents repeated shape checks across UI modules.

Factory inputs are intentionally typed loosely (`any`) because these helpers
are defensive normalizers — they accept whatever shape IndexedDB, seed data,
or network payloads hand over and coerce it into a known good structure. The
*output* types are the contract callers rely on.
*/

import { FRIENDSHIP_STATUS_ACCEPTED } from "../utils/friendships.js";

export const DATA_MODEL_VERSION = 3;

// ---------------------------------------------------------------------------
// Model types — the canonical shapes the rest of the app consumes.
// ---------------------------------------------------------------------------

export interface TransactionModel {
  id: string;
  date: string;
  amount_eur: number;
  note: string;
}

export interface PaymentRequestModel {
  id: string;
  amount_eur: number;
  note: string;
  is_incoming: boolean;
  created_at: string;
}

export interface PendingNameChange {
  oldName: string;
  newName: string;
}

/** `true` = incoming proposal, `false` = outgoing, `"lowered"` = auto-applied lower limit. */
export type PendingCreditLimitDirection = boolean | "lowered" | null;

export interface FriendModel {
  person_id: string;
  person_name: string;
  friendship_status: string;
  debt_eur: number;
  trust_credit_limit_eur: number;
  pending_credit_limit_eur: number | null;
  pending_credit_limit_is_incoming: PendingCreditLimitDirection;
  recent_transactions: TransactionModel[];
  last_viewed_transaction_ids: string[];
  last_synced_at: string;
  pending_payment_request: PaymentRequestModel | null;
  pending_name_change: PendingNameChange | null;
}

/** Backwards compatibility alias for FriendModel */
export type ConnectionModel = FriendModel;

export interface PersonModel {
  id: string;
  name: string;
  public_key: string;
  public_key_hex: string;
  /** Always `""` when produced by `createPublicPersonModel`. */
  private_key: string;
  /** Always `""` when produced by `createPublicPersonModel`. */
  private_key_hex: string;
  friends: FriendModel[];
  /** @deprecated Use friends instead */
  connections?: FriendModel[];
}

export interface LedgerEntryModel {
  id: string;
  timestamp: string;
  type: string;
  from_user_id: string;
  to_user_id: string;
  /** Sender's asserted `created_at` — part of the signed digest. */
  originated_at: string;
  /** Schnorr (BIP-340) signature hex. May be `""` for legacy entries. */
  signature: string;
  payload: Record<string, unknown>;
}

export interface PeerMessageModel {
  id: string;
  type: string;
  from_user_id: string;
  to_user_id: string;
  created_at: string;
  signature: string;
  payload: Record<string, unknown>;
}

export type ContactsMap = Record<string, PersonModel>;

export interface RootState {
  model_version: number;
  user: PersonModel;
  contacts: ContactsMap;
  ledger: LedgerEntryModel[];
  outbox: PeerMessageModel[];
  processed_peer_message_ids: string[];
}

// ---------------------------------------------------------------------------
// Internal coercion helpers — kept `any` so legacy JS call sites pass through.
// ---------------------------------------------------------------------------

const asNumberOrDefault = (value: any, defaultValue: number = 0): number => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : defaultValue;
};

export const normalizeCurrencyAmount = (value: any, defaultValue: number = 0): number => {
  return asNumberOrDefault(value, defaultValue);
};

const asStringOrDefault = (value: any, defaultValue: string = ""): string => {
  return typeof value === "string" ? value : defaultValue;
};

const asTrimmedStringOrDefault = (value: any, defaultValue: string = ""): string => {
  return asStringOrDefault(value, defaultValue).trim();
};

const clonePlainObject = (value: any): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
};

const normalizeStringList = (values: any): string[] => {
  if (!Array.isArray(values)) return [];

  const normalizedValues = new Set<string>();
  values.forEach((value) => {
    const normalizedValue = asTrimmedStringOrDefault(value);
    if (!normalizedValue) return;
    normalizedValues.add(normalizedValue);
  });

  return Array.from(normalizedValues);
};

const normalizeFriendList = (friends: any): FriendModel[] => {
  if (!Array.isArray(friends)) return [];

  const normalizedFriends = new Map<string, FriendModel>();
  friends.forEach((friend) => {
    const normalizedFriend = createFriendModel(friend);
    if (!normalizedFriend.person_id) return;
    normalizedFriends.set(normalizedFriend.person_id, normalizedFriend);
  });

  return Array.from(normalizedFriends.values());
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export const createTransactionModel = (input: any = {}): TransactionModel => {
  return {
    id: asTrimmedStringOrDefault(input.id),
    date: asTrimmedStringOrDefault(input.date),
    amount_eur: asNumberOrDefault(input.amount_eur, 0),
    note: asTrimmedStringOrDefault(input.note),
  };
};

export const createFriendModel = (input: any = {}): FriendModel => {
  const transactions: TransactionModel[] = Array.isArray(input.recent_transactions)
    ? input.recent_transactions.map((transaction: any) => createTransactionModel(transaction))
    : [];
  const lastViewedTransactionIds = normalizeStringList(input.last_viewed_transaction_ids);

  const pendingCreditLimitIsIncoming: PendingCreditLimitDirection =
    input.pending_credit_limit_is_incoming === true
      ? true
      : input.pending_credit_limit_is_incoming === false
      ? false
      : input.pending_credit_limit_is_incoming === "lowered"
      ? "lowered"
      : null;

  return {
    person_id: asTrimmedStringOrDefault(input.person_id),
    person_name: asTrimmedStringOrDefault(input.person_name),
    friendship_status: asTrimmedStringOrDefault(
      input.friendship_status,
      FRIENDSHIP_STATUS_ACCEPTED
    ),
    debt_eur: asNumberOrDefault(input.debt_eur, 0),
    trust_credit_limit_eur: asNumberOrDefault(input.trust_credit_limit_eur, 0),
    pending_credit_limit_eur:
      Number.isFinite(input.pending_credit_limit_eur) && input.pending_credit_limit_eur >= 0
        ? input.pending_credit_limit_eur
        : null,
    pending_credit_limit_is_incoming: pendingCreditLimitIsIncoming,
    recent_transactions: transactions,
    last_viewed_transaction_ids: lastViewedTransactionIds,
    last_synced_at: asTrimmedStringOrDefault(input.last_synced_at),
    pending_payment_request:
      input.pending_payment_request && typeof input.pending_payment_request === "object"
        ? {
            id: asTrimmedStringOrDefault(input.pending_payment_request.id),
            amount_eur: asNumberOrDefault(input.pending_payment_request.amount_eur, 0),
            note: asTrimmedStringOrDefault(input.pending_payment_request.note),
            is_incoming: input.pending_payment_request.is_incoming === true,
            created_at: asTrimmedStringOrDefault(input.pending_payment_request.created_at),
          }
        : null,
    pending_name_change:
      input.pending_name_change &&
      typeof input.pending_name_change.oldName === "string" &&
      typeof input.pending_name_change.newName === "string"
        ? { oldName: input.pending_name_change.oldName, newName: input.pending_name_change.newName }
        : null,
  };
};

/** Backwards compatibility alias for createFriendModel */
export const createConnectionModel = createFriendModel;

export interface CreatePersonModelOptions {
  includePrivateKeys?: boolean;
}

export const createPersonModel = (
  input: any = {},
  options: CreatePersonModelOptions = {}
): PersonModel => {
  const { includePrivateKeys = true } = options;
  const normalizedName = asTrimmedStringOrDefault(input.name);
  const normalizedId = asTrimmedStringOrDefault(input.id);
  const normalizedPublicKey = asTrimmedStringOrDefault(input.public_key);
  const personId = normalizedPublicKey || normalizedId;
  const friends = normalizeFriendList(input.friends || input.connections);

  return {
    id: personId,
    name: normalizedName || "Anonymous",
    public_key: personId,
    public_key_hex: asTrimmedStringOrDefault(input.public_key_hex),
    private_key: includePrivateKeys ? asTrimmedStringOrDefault(input.private_key) : "",
    private_key_hex: includePrivateKeys ? asTrimmedStringOrDefault(input.private_key_hex) : "",
    friends,
  };
};

export const createPublicPersonModel = (input: any = {}): PersonModel => {
  return createPersonModel(input, { includePrivateKeys: false });
};

export const createLedgerEntryModel = (input: any = {}): LedgerEntryModel => {
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

export const createPeerMessageModel = (input: any = {}): PeerMessageModel => {
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

export const createEmptyAppState = (userPerson: any): RootState => {
  return {
    model_version: DATA_MODEL_VERSION,
    user: createPersonModel(userPerson),
    contacts: {},
    ledger: [],
    outbox: [],
    processed_peer_message_ids: [],
  };
};

export const normalizeContactsMap = (contacts: any): ContactsMap => {
  if (!contacts || typeof contacts !== "object") return {};

  return Object.entries(contacts).reduce<ContactsMap>(
    (normalizedContacts, [contactKey, contactValue]: [string, any]) => {
      const normalizedContact = createPublicPersonModel({
        ...contactValue,
        id: contactValue?.id || contactKey,
        public_key: contactValue?.public_key || contactKey,
      });
      if (!normalizedContact.id) return normalizedContacts;
      normalizedContacts[normalizedContact.id] = normalizedContact;
      return normalizedContacts;
    },
    {}
  );
};

export const normalizeAppState = (state: any): RootState | null => {
  if (!state || typeof state !== "object") return null;
  if (!state.user) return null;

  return {
    model_version: DATA_MODEL_VERSION,
    user: createPersonModel(state.user),
    contacts: normalizeContactsMap(state.contacts),
    ledger: Array.isArray(state.ledger)
      ? state.ledger.map((entry: any) => createLedgerEntryModel(entry))
      : [],
    outbox: Array.isArray(state.outbox)
      ? state.outbox.map((entry: any) => createPeerMessageModel(entry))
      : [],
    processed_peer_message_ids: normalizeStringList(state.processed_peer_message_ids),
  };
};
