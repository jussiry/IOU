# IOU Ledger Specification

**Version:** 2  
**Last updated:** 2026-04-18

---

## 1. Overview

The ledger is an append-only log of every peer message the local user has produced or received. It is persisted in IndexedDB (see `specs/data-storage.md`) as the `ledger` array inside the root state object.

Its two primary purposes are:

1. **Audit trail** — a tamper-evident history of all bilateral interactions (friend requests, transactions, trust-limit changes, payment requests).
2. **State recovery** — if a user's IndexedDB is wiped, a peer who still holds their ledger entries can replay them chronologically and fully reconstruct the wiped user's view of the shared relationship.

Unlike the `outbox` (which holds messages pending delivery), the ledger is permanent. Entries are never removed.

---

## 2. Entry Structure

See `specs/data-storage.md §4.4` for the full field table. The key semantic distinction between the two timestamp fields:

| Field | Who sets it | Signed? | Purpose |
|---|---|---|---|
| `timestamp` | Local machine at append time | No | Ordering and display |
| `originated_at` | Sender (copied from `created_at`) | Yes | Digest reconstruction for signature verification |

Because `timestamp` is local it cannot be trusted by a sync peer. `originated_at` is what was inside the sender's signed inner message; it must be preserved unchanged so the Schnorr signature can be re-verified at any future point.

---

## 3. Local Appends

### 3.1 `appendLedgerEntry(state, fields)`

The primitive append. Sets `timestamp` to the current time, normalises through `createLedgerEntryModel`, and **prepends** (unshifts) so the array stays newest-first. Callers supply:

```
id          — matches the originating peer message id
type        — peer message type
fromUserId  — sender npub
toUserId    — recipient npub
payload     — message-type-specific plain object
signature   — Schnorr sig hex from the peer message
originatedAt — the peer message's created_at timestamp
```

### 3.2 `appendLedgerEntryFromMessage(state, message)`

Convenience wrapper for the common case of mirroring an outbound or freshly-applied inbound peer message into the ledger. Copies `message.created_at` → `originatedAt` and `message.signature` → `signature`.

**When to call for outbound messages:** at the moment the command is executed (e.g. `acceptFriend` in `commands/friendship.js` calls this immediately after building and signing the accept message, before the message leaves the outbox). This ensures the entry is in the ledger even if the peer never acknowledges receipt.

**When to call for inbound messages:** inside the message handler, after the handler has applied state changes and determined the message is legitimate. The bridge (`peer/bridge.js`) calls `appendLedgerEntryFromMessage` for every successfully applied inbound peer message as part of `markProcessedPeerMessage`.

---

## 4. Queries

### 4.1 `getLedgerEntriesForPeer(ledger, myId, peerId)`

Returns all entries where `(from_user_id === myId && to_user_id === peerId) || (from_user_id === peerId && to_user_id === myId)`. This is the bilateral slice offered to a **friend** sync peer — entries involving third parties are never forwarded.

### 4.2 `getAllLedgerEntries(ledger)`

Returns a shallow copy of the full ledger. Used by the **self-mesh** (same-user devices) during initial catch-up and live broadcast (see §9): a self-peer is entitled to the full ledger because it represents another device of the same user.

---

## 5. Signature Verification

### 5.1 Why verify?

The AES-256-GCM envelope that wraps sync messages (`sync_data`) proves the *transport peer* produced the batch — but not that the individual entries inside it were authored by whoever they claim. A compromised peer could forward forged entries with a fabricated `from_user_id`. Schnorr verification on each entry's claimed author closes this gap.

### 5.2 `verifyLedgerEntrySignature(entry)`

Reconstructs the inner-message shape from the stored entry:

```js
{
  id:           entry.id,
  type:         entry.type,
  from_user_id: entry.from_user_id,
  to_user_id:   entry.to_user_id,
  created_at:   entry.originated_at || entry.timestamp,
  payload:      entry.payload || {},
  signature:    entry.signature,
}
```

Then calls `verifyInnerSignature(innerShape)` from `peer/envelope.js`, which:

1. Serialises the shape as canonical JSON (fields in a fixed order, `signature` field excluded).
2. Computes SHA-256 of the JSON string.
3. Verifies the BIP-340 Schnorr signature against `from_user_id`'s secp256k1 public key.

Returns `false` if `signature` is absent or empty — unsigned entries are always rejected during sync.

---

## 6. Sync Merge

### 6.1 `mergeSyncedLedgerEntries(state, entries)`

Merges a batch of entries received from a sync peer:

1. Builds a set of existing entry ids.
2. For each entry: normalises, skips duplicates, runs `verifyLedgerEntrySignature`.
3. Entries that fail verification are logged and discarded.
4. New entries are prepended; after the loop the array is sorted descending by `timestamp`.
5. Returns the count of entries actually added.

Does **not** persist. The caller owns persistence so a single `saveAppState` can cover the ledger update and any concurrent state changes.

---

## 7. Recovery via Peer Sync

When a user's IndexedDB is wiped (data loss, device migration, or a deliberate test reset), peers who hold the other side of the ledger can fully reconstruct the wiped user's view of each shared relationship. The mechanism is the sync protocol (fully described in `specs/peer-communication.md §12`); this section focuses on what happens at the ledger and handler level.

### 7.1 Prerequisites

Sync is initiated only after the WebSocket server signals `queue_drained`, ensuring any server-queued envelopes (normal inbound messages) are delivered first. This prevents re-requesting entries that are about to arrive anyway via the regular inbound path.

### 7.2 Entry Classification

When `sync_data` arrives with a batch of ledger entries, each entry (after signature verification) is placed into one of two buckets:

| Bucket | Condition | Processing |
|---|---|---|
| `inboundLike` | `entry.to_user_id === myId` | Applied via `applyInboundPeerMessage` — full handler logic runs |
| `outboundOnly` | `entry.from_user_id === myId` | Inserted into ledger via `addLedgerEntries` — no handler, state not changed |

Entries addressed to neither side are silently dropped (should not occur for well-behaved peers; `getLedgerEntriesForPeer` on the sender side prevents this).

`outboundOnly` entries represent the user's own past outbound messages that were stored in the peer's ledger. They are backfilled into the local ledger for completeness but cannot affect local state (the local user's own actions are already reflected; the peer cannot add new obligations on the user's behalf).

### 7.3 Chronological Replay

`inboundLike` entries are sorted ascending by `timestamp` before replay. This matters for recovery: a `tx_created` entry can only apply after the `friend_accept` that re-created the connection. Replaying out of order would cause the transaction handler to fail to find the connection and silently drop the entry.

### 7.4 The `friend_accept` Recovery Path

`applyFriendAcceptMessage` (in `peer/handlers.js`) handles the case where no connection exists yet at replay time — i.e. the wiped user has no record of the friendship. The handler:

1. Detects that no `userConnection` exists (`isRecovery = !userConnection`).
2. Calls `ensureUserConnection` to create the connection with `friendship_status: accepted`.
3. Because `isRecovery` is `true`, skips the `wasAccepted` check that would otherwise return `null` (the shortcut for "friend was already accepted — nothing to do").
4. Returns a notification object so the caller knows the message was processed.
5. The caller (`routeInboundMessage`) calls `markProcessedPeerMessage`, adding the entry's id to `processed_peer_message_ids`, ensuring the same `friend_accept` is not replayed again on the next sync.

Without step 3 the function would return `null` in recovery (because `ensureUserConnection` immediately sets `friendship_status: accepted`, making the subsequent `isAcceptedFriendshipStatus` check return `true`). `routeInboundMessage` treats a `null` return as an illegal/unhandled message and does **not** call `markProcessedPeerMessage`, causing the entry to be re-processed every time the peer reconnects — an infinite recovery loop.

### 7.5 Trust-Limit Recovery

The `friend_accept` message payload carries `trust_credit_limit_eur` — the value the accepter agreed to from the original `friend_request`. Replaying the `friend_accept` during recovery restores the established limit without any extra negotiation.

Bob's subsequent `trust_limit_update` (a `friend_trust_limit` message) arrives as a separate ledger entry. If it is also in the peer's ledger it will be replayed in chronological order after `friend_accept`, resulting in the lowered limit.

### 7.6 Remote Peer Allowance Timer

When a wiped user reconnects, peers who do not yet have a `peer_connect` signal from the server for the wiped user may still initiate a WebRTC connection via their own `peer_connect` — because the wiped user looks like a new registrant on the signalling server. The `REMOTE_INITIATED_PEER_GRACE_PERIOD_MS = 15000` (15-second) timer in `peer/mesh.js` keeps such a connection alive even when it is not in the wiped user's current `peerIds` snapshot (which starts empty after wipe). Without this grace period the connection would be immediately closed by `closePeersNotInSet` before the sync could complete.

---

## 8. Multi-Device Live Broadcast

Beyond recovery-after-wipe, the ledger is also the convergence substrate for a single user running multiple devices (laptop + phone, two browsers, etc.). Each device keeps its own IndexedDB record; the ledger is what brings them into agreement.

The mechanism has two halves:

1. **Initial catch-up (on self-peer connection).** As soon as a WebRTC data channel opens between two devices of the same user, they exchange `sync_hello` / `sync_data` exactly as friend sync would, except the sender returns *all* ledger entries whose id is missing from the initiator's `known_ids` (not the bilateral slice). Entries are verified, classified, and replayed identically to §7.
2. **Live broadcast (on every append).** Whenever the local client appends a ledger entry — whether from an outbound action or a freshly-applied inbound peer message — it MUST push that entry to every currently connected self-peer as a `sync_data` batch containing a single entry (or a small tail).

### 8.1 Loop Prevention

Without guardrails the live broadcast would echo forever: A broadcasts to B, B appends and broadcasts back to A, A appends and broadcasts again. Two cooperating rules break the cycle:

- The sender maintains a `broadcastedLedgerIds` set and skips any entry already in it.
- On receiving `sync_data` via the self-mesh, the receiver **seeds this set with each inbound id before applying the entries**. The resulting data-change tick therefore sees the id as "already broadcast" and the entry is not echoed back.

### 8.2 No Receipts on Self-Sync

Self-sync inner messages do not generate receipts (see `specs/peer-communication.md §13.7`). After convergence, both devices share identical `processed_peer_message_ids` maps, so an acknowledgement would be redundant; moreover, a receipt from device A to device A' would itself trigger a broadcast, causing unbounded fan-out.

### 8.3 Signature Handling

Every self-sync entry still carries its original BIP-340 Schnorr signature and is verified by the receiver exactly like a friend-sync entry. Reusing the signature path keeps the merge code DRY and guarantees that even if the self-mesh were somehow spoofed, forged entries with invalid signatures would be rejected before touching local state.

---

## 9. Security Properties

| Property | Mechanism |
|---|---|
| **Authorship integrity** | Every entry carries a BIP-340 Schnorr signature by `from_user_id`; `verifyLedgerEntrySignature` rejects entries without a valid signature |
| **Non-repudiation** | The signature is over the canonical inner-message digest (id, type, from/to, created_at, payload); neither the transport peer nor the server can produce a valid signature for a different `from_user_id` |
| **No forged history** | `mergeSyncedLedgerEntries` and `handleSyncData` reject unsigned or invalidly-signed entries before they enter the local state |
| **Replay-safe deduplication** | `processed_peer_message_ids` prevents the same entry from being applied twice, even across multiple sync cycles |
| **Bilateral isolation** | `getLedgerEntriesForPeer` only shares entries involving both parties; third-party conversations are never forwarded |

### 9.1 Limitations

- **Key compromise** — if a user's private key is stolen, an attacker can produce valid signatures for arbitrary messages. There is currently no key rotation mechanism.
- **Timestamp forgery** — `originated_at` is sender-asserted and covered by the signature, so it cannot be altered after signing; however, a malicious sender can choose any timestamp at signing time.
- **Selective disclosure** — a peer can withhold entries from `sync_data`. There is no way for the recovering peer to know that entries are missing. Full recovery depends on peers being cooperative.
