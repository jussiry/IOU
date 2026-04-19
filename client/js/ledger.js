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

import { createLedgerEntryModel } from "./models/data-model.js";
import { verifyInnerSignature } from "./peer/envelope.js";
import { createId } from "./state-utils.js";

// ---------------------------------------------------------------------------
// Local appends
// ---------------------------------------------------------------------------

// Primitive append. Callers pass the domain fields; this normalizes through
// the model factory so shape drift can only happen in one place. The local
// `timestamp` is set here — peer-asserted timing lives in `originated_at`.
export const appendLedgerEntry = (
  state,
  {
    id,
    type,
    fromUserId,
    toUserId,
    payload = {},
    signature = "",
    originatedAt = "",
  } = {},
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
    }),
  );
};

// Convenience wrapper: mirror an outbound or verified inbound peer message
// into the ledger. The message's `created_at` becomes `originated_at` so the
// Schnorr digest remains reproducible from the stored entry.
export const appendLedgerEntryFromMessage = (state, message) => {
  if (!message) return;
  appendLedgerEntry(state, {
    id: message.id,
    type: message.type,
    fromUserId: message.from_user_id,
    toUserId: message.to_user_id,
    payload: message.payload,
    signature: message.signature,
    originatedAt: message.created_at,
  });
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// Entries that belong to the conversation between `myId` and `peerId` — the
// slice we offer during sync. Entries involving third parties never flow to
// this peer.
export const getLedgerEntriesForPeer = (ledger, myId, peerId) => {
  if (!Array.isArray(ledger)) return [];
  return ledger.filter(
    (entry) =>
      (entry.from_user_id === myId && entry.to_user_id === peerId) ||
      (entry.from_user_id === peerId && entry.to_user_id === myId),
  );
};

// The full ledger as-is — used for same-user (device-to-device) sync where
// every entry is in-scope because every entry was authored or received by
// *this* user regardless of which friend it concerned.
export const getAllLedgerEntries = (ledger) => {
  if (!Array.isArray(ledger)) return [];
  return ledger.slice();
};

// ---------------------------------------------------------------------------
// Signature verification for untrusted entries
// ---------------------------------------------------------------------------

// Reconstructs the original inner-message shape from a stored ledger entry
// and runs the Schnorr verification that `peer-envelope` uses for live
// messages. AES-GCM on the sync envelope only proves the *transport* peer
// produced the batch — for forwarded or third-party entries we also need
// this signature check to trust authorship.
export const verifyLedgerEntrySignature = async (entry) => {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.signature !== "string" || !entry.signature) return false;
  const innerShape = {
    id: entry.id,
    type: entry.type,
    from_user_id: entry.from_user_id,
    to_user_id: entry.to_user_id,
    created_at: entry.originated_at || entry.timestamp || "",
    payload: entry.payload || {},
    signature: entry.signature,
  };
  return verifyInnerSignature(innerShape);
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
export const mergeSyncedLedgerEntries = async (state, entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  state.ledger = Array.isArray(state.ledger) ? state.ledger : [];
  const existingIds = new Set(state.ledger.map((entry) => entry.id));
  let added = 0;

  for (const entry of entries) {
    const normalized = createLedgerEntryModel(entry);
    if (!normalized.id || existingIds.has(normalized.id)) continue;
    const signatureValid = await verifyLedgerEntrySignature(normalized);
    if (!signatureValid) {
      console.warn(
        "[Ledger] Rejected synced entry with missing or invalid signature:",
        normalized.id,
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
