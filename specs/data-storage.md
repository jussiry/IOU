# IOU Data Storage Specification

**Version:** 1  
**Last updated:** 2026-04-18

---

## 1. Overview

The IOU client stores all application state in a single IndexedDB record. There is no remote database; every piece of user data — identity, friends, transactions, and the peer-message ledger — lives exclusively in the browser. Peers synchronise directly with each other over WebRTC; the signalling server is stateless beyond a short delivery queue.

A single user MAY be logged in on several devices at the same time — each browser tab / install gets its own IndexedDB record. Convergence between those records is not a storage concern; it is handled at the peer layer (see `specs/peer-communication.md §13` and `specs/ledger.md §8`). Each device is assigned an ephemeral `device_id` by the relay server on every WebSocket connection; this id is **not** persisted in IndexedDB.

This document describes:
- the IndexedDB layout,
- every field in the root state object,
- the data model types and their invariants, and
- how state is loaded, saved, and cleared.

---

## 2. IndexedDB Layout

| Parameter | Value |
|---|---|
| Database name | `iou_client_db` |
| Database version | `1` |
| Object store | `app_state` |
| Record key | `root_state` |

There is exactly one record. The store has no index; all access goes through the well-known key.

```
iou_client_db (v1)
└── app_state (object store)
    └── "root_state"  →  RootState
```

### 2.1 Opening and timeouts

Reads time out after **2 seconds** and return `null` on timeout. Writes time out after **4 seconds** and throw. If the database connection stalls (version-change event from another tab, open request blocked), the cached promise is reset so the next call reopens cleanly.

`window.clearAppState` is exposed on the global object as a convenience for developer console use.

### 2.2 Multi-tab safety for reset

When the user asks to be "removed" from the device, the implementation deletes the **entire IndexedDB database** (`deleteDatabase()`), not just the `root_state` record. A per-record `delete` is unsafe while other tabs of the same origin may still hold the previous `RootState` in their in-memory `cachedState`: any save from such a tab would resurrect a stale record immediately after the reset tab wipes it. Dropping the database forces every tab to go through `openDatabase` again, and the reset tab's subsequent reload then determines what (if anything) gets written back.

`deleteDatabase()` closes the local connection first so the deletion is not blocked by its own open handle. `onblocked` and `onerror` still resolve the promise — the caller is expected to reload the page immediately after, which drops any other open handle.

---

## 3. Root State (`RootState`)

```ts
{
  model_version: number,          // DATA_MODEL_VERSION constant (currently 3)
  user: PersonModel,              // the local user (includes private keys)
  contacts: ContactsMap,          // key → ContactModel (public info only)
  ledger: LedgerEntryModel[],     // append-only signed message log
  outbox: PeerMessageModel[],     // messages waiting for delivery
  processed_peer_message_ids: string[], // deduplication set
}
```

`model_version` is checked on load. Migration is not yet implemented; a mismatch causes the caller to treat the record as absent and fall back to the welcome flow. The constant `DATA_MODEL_VERSION = 3` is exported from `client/js/models/data-model.js`.

---

## 4. Data Model Types

All factory functions (`createPersonModel`, `createConnectionModel`, etc.) normalise inputs defensively: unknown fields are dropped, wrong types coerce to safe defaults, and the model registry is the single source of truth for field shape. Callers must go through these factories rather than constructing shapes inline.

### 4.1 PersonModel

Represents the local user (stored under `user`). Contains private key material.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | `""` | Equals `public_key` (npub format) |
| `name` | string | `"Anonymous"` | Display name, trimmed |
| `public_key` | string | `""` | Nostr npub — used as the canonical peer identifier |
| `public_key_hex` | string | `""` | Same key in 32-byte hex (x-only secp256k1) |
| `private_key` | string | `""` | Nostr nsec — used for signing and ECDH |
| `private_key_hex` | string | `""` | Same key in 32-byte hex |
| `connections` | ConnectionModel[] | `[]` | Deduplicated by `person_id` |

`createPublicPersonModel` returns the same shape with `private_key` and `private_key_hex` forced to `""`. Used for contact records.

### 4.2 ConnectionModel

Represents one bilateral friendship stored inside `user.connections`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `person_id` | string | `""` | Peer's npub; used as the unique key |
| `person_name` | string | `""` | Display name as last received from the peer |
| `friendship_status` | string | `"accepted"` | One of `pending_outgoing`, `pending_incoming`, `accepted`, `rejected` |
| `debt_eur` | number | `0` | Positive = peer owes you; negative = you owe the peer |
| `trust_credit_limit_eur` | number | `0` | Agreed maximum credit exposure |
| `pending_credit_limit_eur` | number \| null | `null` | Proposed new limit awaiting acceptance; `null` when none |
| `pending_credit_limit_is_incoming` | bool \| `"lowered"` \| null | `null` | Direction/kind of pending limit change: `true` = incoming proposal, `false` = outgoing proposal, `"lowered"` = auto-applied lower limit |
| `recent_transactions` | TransactionModel[] | `[]` | Short tail of recent transactions for display |
| `last_synced_at` | string | `""` | ISO-8601 timestamp of the last successful WebRTC sync with this peer |
| `pending_payment_request` | PaymentRequestModel \| null | `null` | At most one active payment request per connection |
| `pending_name_change` | `{oldName, newName}` \| null | `null` | Displayed while waiting for user confirmation |

#### PaymentRequestModel (inline in ConnectionModel)

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `amount_eur` | number | |
| `note` | string | |
| `is_incoming` | boolean | `true` = the peer sent it to you |
| `created_at` | string | ISO-8601 |

### 4.3 TransactionModel

Stored inside `ConnectionModel.recent_transactions`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `date` | string | YYYY-MM-DD |
| `amount_eur` | number | Positive = received, negative = paid |
| `note` | string | |

### 4.4 LedgerEntryModel

One entry in the append-only local ledger. See the Ledger spec for full semantics.

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | `""` | Matches the originating peer message `id` |
| `timestamp` | string | `""` | ISO-8601; set locally when the entry is appended |
| `type` | string | `""` | Peer message type (e.g. `friend_request`, `tx_created`) |
| `from_user_id` | string | `""` | Sender's npub |
| `to_user_id` | string | `""` | Recipient's npub |
| `originated_at` | string | `""` | Sender's `created_at` from the original peer message; needed to reconstruct the Schnorr digest |
| `signature` | string | `""` | Schnorr (BIP-340) signature hex over the canonical inner-message digest |
| `payload` | object | `{}` | Message-type-specific data (deep-cloned plain object) |

`timestamp` is set by the local machine at append time; it is not covered by the signature. `originated_at` is the sender-asserted timestamp that *is* covered by the signature; it must be preserved to allow post-hoc verification.

### 4.5 PeerMessageModel

Entries in the outbox — messages queued for delivery that have not yet been acknowledged.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique identifier |
| `type` | string | Peer message type |
| `from_user_id` | string | Local user's npub |
| `to_user_id` | string | Recipient's npub |
| `created_at` | string | ISO-8601 timestamp at creation |
| `signature` | string | Schnorr signature (may be empty for legacy outbox items) |
| `payload` | object | Deep-cloned |

### 4.6 ContactsMap

A plain object keyed by npub. Values are `ContactModel` (= `createPublicPersonModel` output, no private keys).

```ts
{
  [npub: string]: {
    id: string,
    name: string,
    public_key: string,       // npub
    public_key_hex: string,   // hex
    private_key: "",          // always empty
    private_key_hex: "",      // always empty
    connections: [],          // always empty for contacts
  }
}
```

Contacts are created when a peer message is first received from someone not yet in the map. They provide the public key material needed for ECDH and signature verification before the friendship is fully established.

### 4.7 processed_peer_message_ids

A `string[]` acting as a deduplication set. When an inbound peer message is successfully applied, its `id` is added here. On subsequent receives the message is silently dropped before processing. The array is normalised (deduplicated, empty strings removed) on every `normalizeAppState` call.

---

## 5. Storage API

All storage access goes through `client/js/storage/indexeddb.js`.

| Export | Signature | Behaviour |
|---|---|---|
| `loadAppState` | `() → RootState \| null` | Reads the record; returns `null` on miss or 2 s timeout |
| `saveAppState` | `(state) → state` | Overwrites the record; throws on 4 s timeout |
| `clearAppState` | `() → void` | Deletes the `root_state` record from the object store (single-tab scenarios only) |
| `deleteDatabase` | `() → void` | Drops the entire `iou_client_db` database; used by the "remove user" flow for the multi-tab-safe reset described in §2.2 |

There is no partial-update API; the entire root state is always written atomically as a single IndexedDB `put`. Callers load state, mutate in memory, then call `saveAppState`.

---

## 6. State Normalisation

`normalizeAppState(state)` runs every model field through the corresponding factory function, producing a clean `RootState` from whatever is loaded from disk. This is the only point where unknown fields are stripped and defaults are applied. It also re-applies `DATA_MODEL_VERSION` so old records are silently upgraded in shape (though the version number itself is not yet used for migration logic).

`createEmptyAppState(userPerson)` builds a minimal valid state for a brand-new user: empty connections, contacts, ledger, outbox, and processed-IDs list.

---

## 7. Dev Seed System

During development the app accepts a `__IOU_SEED_STATE` property on `window` (injected by the Playwright harness or manually). On startup, if this property is present, the app clears IndexedDB and writes the seed state, then removes the property. This allows E2E tests to inject any fixture state without going through the UI flows.

The URL parameter `?seed=<name>` triggers one of the built-in seed builders (alice, bob, carol) but only if no user state already exists. `?removeUser` clears IndexedDB so a subsequent seed can apply.
