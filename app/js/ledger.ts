/*
Central module for the local ledger — the append-only log of every peer
message the user has produced or received.

Responsibilities live here rather than scattered across app-state.js,
state-utils.js, and the realtime module so the invariants of the ledger
(canonical entry shape, signature coverage, per-peer slicing, sync merge
semantics) can be reasoned about in one place.

Domain callers still decide *when* to append (a transaction, a friend
accept, a trust-limit nudge) and supply the payload — this module only
owns how entries are shaped, how they're filtered for sync, and how
untrusted entries are vetted before they enter the local log.
*/

import {
  createLedgerEntryModel,
  type AuthorshipProof,
  type LedgerEntryModel,
  type PeerMessageModel,
  type RootState,
} from "./models/data-model.js";
import { verifyTallyAuthorship } from "./peer/authorship.js";
import { createId } from "./state-utils.js";

// ---------------------------------------------------------------------------
// Local appends
// ---------------------------------------------------------------------------

export interface AppendLedgerEntryOptions {
  id?: string;
  type?: string;
  fromUserId?: string;
  toUserId?: string;
  payload?: Record<string, unknown>;
  signature?: string;
  authorship?: AuthorshipProof | null;
  originatedAt?: string;
}

// Primitive append. Callers pass the domain fields; this normalizes through
// the model factory so shape drift can only happen in one place. The local
// `timestamp` is set here — peer-asserted timing lives in `originated_at`.
export const appendLedgerEntry = (
  state: RootState,
  {
    id,
    type,
    fromUserId,
    toUserId,
    payload = {},
    signature = "",
    authorship = null,
    originatedAt = "",
  }: AppendLedgerEntryOptions = {}
): LedgerEntryModel => {
  state.ledger = Array.isArray(state.ledger) ? state.ledger : [];
  const entry = createLedgerEntryModel({
    id: id || createId("ledger"),
    timestamp: new Date().toISOString(),
    type,
    from_user_id: fromUserId || "",
    to_user_id: toUserId || "",
    signature,
    authorship,
    originated_at: originatedAt,
    payload,
  });
  state.ledger.unshift(entry);
  return entry;
};

// Convenience wrapper: mirror an outbound or verified inbound peer message
// into the ledger. The message's `created_at` becomes `originated_at` so the
// Schnorr digest remains reproducible from the stored entry. Returns the
// appended entry so callers can derive state directly from the ledger
// representation (the same shape replay and sync will see).
export const appendLedgerEntryFromMessage = (
  state: RootState,
  message: PeerMessageModel | null | undefined
): LedgerEntryModel | null => {
  if (!message) return null;
  return appendLedgerEntry(state, {
    id: message.id,
    type: message.type,
    fromUserId: message.from_user_id,
    toUserId: message.to_user_id,
    payload: message.payload,
    signature: message.signature,
    authorship: message.authorship,
    originatedAt: message.created_at,
  });
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// Entries that belong to the conversation between `myId` and `peerId` — the
// slice we offer during sync. Entries involving third parties never flow to
// this peer.
export const getLedgerEntriesForPeer = (
  ledger: LedgerEntryModel[] | null | undefined,
  myId: string,
  peerId: string
): LedgerEntryModel[] => {
  if (!Array.isArray(ledger)) return [];
  return ledger.filter(
    (entry) =>
      (entry.from_user_id === myId && entry.to_user_id === peerId) ||
      (entry.from_user_id === peerId && entry.to_user_id === myId)
  );
};

// The full ledger as-is — used for same-user (device-to-device) sync where
// every entry is in-scope because every entry was authored or received by
// *this* user regardless of which friend it concerned.
export const getAllLedgerEntries = (
  ledger: LedgerEntryModel[] | null | undefined
): LedgerEntryModel[] => {
  if (!Array.isArray(ledger)) return [];
  return ledger.slice();
};

// ---------------------------------------------------------------------------
// Signature verification for untrusted entries
// ---------------------------------------------------------------------------

// Reconstructs the original inner-message shape from a stored ledger entry and
// runs the same authorship verification that `peer-envelope` uses for live
// messages. AES-GCM on the sync envelope only proves the *transport* peer
// produced the batch — for forwarded or third-party entries we also need this
// authorship check to trust who actually authored the entry.
//
// Accepts either a TIP-006 authorship proof (`tally-nostr-event-v1` /
// `tally-canonical-schnorr-v1`) or, for pre-migration entries, a bare
// top-level `signature` — `verifyTallyAuthorship` handles both.
export const verifyLedgerEntryAuthorship = async (
  entry: LedgerEntryModel | null | undefined
): Promise<boolean> => {
  if (!entry || typeof entry !== "object") return false;
  const innerShape = {
    id: entry.id,
    type: entry.type,
    from_user_id: entry.from_user_id,
    to_user_id: entry.to_user_id,
    created_at: entry.originated_at || entry.timestamp || "",
    payload: entry.payload || {},
    signature: entry.signature,
    authorship: entry.authorship || null,
  };
  return verifyTallyAuthorship(innerShape);
};

// ---------------------------------------------------------------------------
// Sync merge
// ---------------------------------------------------------------------------

// Merge a batch of entries received from a sync peer into the local ledger.
// Entries without a valid Schnorr signature by their claimed `from_user_id`
// are rejected — this is what blocks a compromised peer from backfilling
// forged history during recovery. Returns the count actually added.
//
// Does not persist; callers own persistence so a single save can cover
// whatever else changed in the same tick.
export const mergeSyncedLedgerEntries = async (
  state: RootState,
  entries: unknown
): Promise<number> => {
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  state.ledger = Array.isArray(state.ledger) ? state.ledger : [];
  const existingIds = new Set(state.ledger.map((entry) => entry.id));
  let added = 0;

  for (const entry of entries) {
    const normalized = createLedgerEntryModel(entry);
    if (!normalized.id || existingIds.has(normalized.id)) continue;
    const authorshipValid = await verifyLedgerEntryAuthorship(normalized);
    if (!authorshipValid) {
      console.warn(
        "[Ledger] Rejected synced entry with missing or invalid authorship:",
        normalized.id
      );
      continue;
    }
    state.ledger.unshift(normalized);
    existingIds.add(normalized.id);
    added += 1;
  }

  if (added > 0) {
    state.ledger.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }
  return added;
};
