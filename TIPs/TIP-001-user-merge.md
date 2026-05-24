# TIP-001: User Merge

| Field  | Value |
|--------|-------|
| Number | TIP-001 |
| Title  | User Merge |
| Status | Draft |
| Author | Jussi Rytkönen |
| Created | 2026-05-03 |

---

## Summary

A mechanism for merging two existing Tally identities — both owned by the same person — into one. The old user's private key is imported into the device running the new user, and used to sign and broadcast a merge announcement to all of the old user's friends. Friends replace the old user connection with the new user. Once all friends have acknowledged, the old identity is fully deprecated.

---

## Motivation

Users may end up with two separate identities — for example after creating a throwaway account, after losing access to a device, or after deliberately splitting identities for different social circles. The merge flow lets them consolidate to a single identity while preserving all existing relationships and balances.

The key insight is that relationships and debts live in the friends' ledgers, not only in the user's own. A merge must therefore propagate outward: the old user signals every friend, and the friend re-wires their local connection from the old identity to the new one.

---

## Trust Model

Both the old and new user are controlled by the same person. This is a first-party operation, not a transfer between strangers. The threat model is therefore:

- **Internal**: accidental actions from the old device during the merge transition (bugs, race conditions, user error). These are handled primarily through UI locking and message ordering.
- **External**: a third party who has obtained the old private key (key theft). This is a pre-existing risk regardless of the merge feature — handled the same way key compromise is always handled.

The old user is not treated as adversarial. The design goals for the in-flight / race-condition handling are **correctness and avoiding error states**, not protection against a malicious actor.

---

## Message Routing — How the Announcement Reaches Friends

Before describing the merge steps it is worth explaining the relevant property of the server's `queue_peer_envelope` handler, because this determines the simplest implementation path.

When a client sends `queue_peer_envelope` the server checks:
- The sending client is registered (has a `user_id`)
- The `to_user_id` is present and not the sender
- Required envelope fields (`id`, `from_user_id`, `ciphertext`) exist

**The server does not validate that `envelope.from_user_id` matches the sending client's own `user_id`.** It routes purely by `to_user_id`. If the recipient is online the envelope is delivered immediately over WebSocket; if offline it is queued for delivery on reconnection. Neither path involves WebRTC or the `peer_candidates` eligibility check.

This means: the new device — registered with the server as `new_pubkey` — can send an envelope with `from_user_id: old_pubkey` to any of the old user's friends. The server will deliver it. The envelope is signed with the old private key, so signature verification on the receiving end passes correctly. From the friend's perspective the message is cryptographically identical to one the old device sent itself.

No second WebSocket connection, no changes to the server, and no WebRTC establishment with new friends is needed for announcement delivery. The entire merge announcement flow runs through the existing server relay, reusing the same path ordinary offline messages already use.

---

## Design

### 1. Importing the old key

The user imports the old private key into the new device using the same encrypted key export that already exists for "Transfer user to another device or server" (NIP-49 / `ncryptsec` blob + passphrase). No new key-transport primitive is needed.

Once imported, the new device holds both private keys temporarily — the new user's (permanent) and the old user's (used only to produce and sign the merge announcement and subsequent deprecation messages).

### 2. Merge announcement message

The new device (acting as the old user at the cryptographic layer) sends a **MergeAnnouncement** to every friend of the old user. It does this by calling `queue_peer_envelope` once per friend, with `from_user_id: old_pubkey` and content signed by the old private key. The server delivers immediately if the friend is online, or queues for offline delivery — the same path regular messages already take.

The inner message content:

```
MergeAnnouncement {
  kind:             "merge_announcement"
  old_pubkey:       <old user's public key>
  new_pubkey:       <new user's public key>
  merge_id:         <random UUID — idempotency token>
  freeze_seq:       <old user's last outgoing event sequence number>
  balance_snapshot: <map of friend_pubkey → balance, from old user's perspective>
  timestamp:        <unix ms>
  signature:        <signed by old private key over all above fields>
}
```

Fields explained:

- **merge_id** — unique per merge operation. Friends store this and ignore duplicate announcements, making the operation idempotent.
- **freeze_seq** — the sequence number of the last event the old user legitimately dispatched before initiating the merge. Friends use this as a high-water mark to accept any buffered-but-in-flight messages from old user up to and including this number, and to safely ignore anything after.
- **balance_snapshot** — the old user's view of each balance at the moment of freezing. Used for cross-referencing and reconciliation, not as a settlement instruction (see §4).
- **signature** — signed by the old private key over all above fields. This proves to the friend that the merge was authorised by the holder of the old key (i.e. the user themselves), not forged by a third party.

### 3. Ledger stacking

The old user's transaction history is merged into the new user's ledger as a historical baseline. The new user's ledger takes logical precedence: in any conflict (e.g. duplicate event IDs, clashing trust limits) the new user's record wins. Events are ordered by timestamp, with the new user's events considered canonical for the same instant.

### 4. Friend behaviour on receipt

When a friend receives a MergeAnnouncement:

1. **Validate the signature** — reject if invalid.
2. **Check merge_id** — if already seen, ignore (idempotent).
3. **Check if connected to both old and new user** — if yes, enter the **dual-connection reconciliation flow** (see §6).
4. Otherwise: create a connection to `new_pubkey` if not already present, inheriting the old user's trust limit and carrying over the balance from the friend's own ledger.
5. Remove the old user connection.
6. Send a **MergeAck** back to the old user (so the old device can track deprecation progress).

**On the balance snapshot**: friends carry forward their own locally recorded balance with the old user — that is their ground truth. The `balance_snapshot` from the announcement is compared against it purely to surface any discrepancy (e.g. a transaction that was sent by old user but never delivered before the merge). If there is a meaningful difference, the friend is shown a reconciliation prompt. The snapshot is never applied automatically.

### 5. Old device behaviour after initiating merge

Immediately upon dispatching the MergeAnnouncement, the old device enters **deprecated mode**:

- All outgoing transaction and friend-request actions are blocked in the UI. This is the primary safeguard against accidental actions.
- The device remains reachable to receive MergeAck messages and to display deprecation progress to the user ("8 of 12 friends have switched over").
- The old private key is discarded from the new device's memory once the session ends.

The old device is fully deprecated once all friends have sent MergeAck. At that point the app prompts the user to remove the old user data from the old device (the existing "remove user" flow).

### 6. Dual-connection reconciliation

If a friend is connected to both the old and new user:

- They have two separate balances. These must be combined into one.
- **Default rule**: add the two balances together. If old user owes friend €20 and new user owes friend €5, the merged balance is new user owes friend €25.
- The app presents a clear summary before the friend confirms: "Alice (old account) owed you €20. Alice (new account) owed you €5. After merge, Alice owes you €25."
- Trust limit: take the more generous of the two existing limits.
- The friend confirms before anything is applied locally.

### 7. Handling in-flight messages

**The scenario**: old device dispatches a transaction to friend F at moment T. At moment T+1 the merge is initiated and the MergeAnnouncement is dispatched. In the current single-server architecture, server message ordering means F receives the transaction before the announcement — no problem. In a future multi-relay architecture the two could arrive out of order.

**Resolution — freeze_seq watermark**:

The `freeze_seq` field in the announcement is a high-water mark. Any message from the old user with seq ≤ freeze_seq was legitimately dispatched before the merge and must be accepted. Any message with seq > freeze_seq was dispatched after the merge (which deprecated mode should prevent in the first place) and can be safely ignored.

This is deterministic, requires no timer or grace period, and handles the multi-relay edge case cleanly without any extended trust in the old key.

**Alternative considered — grace period**:

The new device could accept transactions signed by the old key for a short window, in the same way cloned devices currently share a key. This is more tolerant of unusual scenarios but is unnecessary given deprecated mode + freeze_seq, and adds implementation complexity. Excluded from v1.

---

## Security Analysis

### Signature — what it proves

The MergeAnnouncement signed by the old private key proves that the holder of the old key authorised the merge. Since both accounts are the same person's, this is the intended proof: it tells friends "this is really me asking you to update my connection, not a third party forging my identity".

Every field including `new_pubkey` is covered by the signature, so a man-in-the-middle cannot substitute a different target key without breaking signature verification.

### Key compromise by a third party

If an attacker has obtained the old private key, they could forge a MergeAnnouncement pointing to their own identity — redirecting the victim's friends to connect to the attacker instead. This is not a new risk introduced by the merge feature; it is the standard consequence of key compromise. The merge flow does not make this easier or harder than any other action the attacker could take with a stolen key.

The receiving friend's UI should display the new user's name and key clearly and require explicit confirmation, so friends have a chance to notice something is wrong. This mirrors the care already taken when initially adding a friend.

### Idempotency and replay

The `merge_id` (random UUID stored by each friend) ensures the announcement is processed exactly once. A delayed or duplicated delivery of the same announcement has no effect after the first processing.

### Accidental old-user actions

This is the primary practical concern given the first-party trust model. Mitigations in order of importance:

1. **Deprecated mode UI lock** — the most effective mitigation. The old device cannot initiate transactions once merge has started.
2. **freeze_seq watermark** — handles the small window between the last legitimate old-user action and the moment the announcement arrives at each friend.
3. **Message queue ordering** — in the current single-server architecture, the announcement arrives at friends before any subsequent messages from old user (there shouldn't be any, but this is a belt-and-suspenders guarantee).

### Friend removal / debt absolution dependency

The MergeAck (removal notice from friend back to old user) depends on a clean friend-removal primitive with debt absolution. That primitive is not yet implemented. When it is built: the balance with the old user is considered transferred to the new user at the moment of the MergeAck, so old user's ledger with that friend settles to zero.

---

## UI Sketch

### New device — initiate merge (Settings → Merge another account)

1. Enter passphrase + paste `ncryptsec` of old account (same form as importing a transferred user).
2. App decrypts and displays: "Old account: Alice (npub1abc…). Merge into your current account?"
3. Confirm → old device enters deprecated mode, announcements dispatched.
4. Progress screen: "Notifying friends… 8 / 12 updated."
5. When complete: "Merge done. You can now remove the old account from any other devices."

### Friend's device — receiving the announcement

1. Notification / banner: "Alice has consolidated to a new account. Update your connection?"
2. Shows: current balance, current trust limit, the new account's name and key, confirm button.
3. Dual-connection case: extra reconciliation screen showing combined balance before confirmation.

### Old device — deprecated state

- All action buttons disabled. Banner: "This account has been merged into a new one. 8 / 12 friends updated."
- Option to resend the announcement to friends who have not yet acknowledged (they may have been offline).
- Once all friends acknowledged: prompt to delete old account data.

---

## Open Questions

1. **Partial merge** — should it be possible to merge only a subset of old-user connections? For v1 no; user can manually add remaining friends to the new account instead.

2. **Chain of merges** — if a user has merged twice (A→B, B→C), should friends of A eventually learn about C? Would require a merge history on the profile. Exclude for v1.

3. **Offline friends and TTL** — if a friend never comes online, the old account can never fully deprecate. Should there be a TTL after which the old account is forcibly removed regardless, accepting that the disconnected friend will have a stale identity reference until they next sync?

4. **Revocation on the new user's profile** — the new user could publish a signed statement "npub1old… is my former account" as a secondary verification signal for friends. Requires some form of addressable public profile, which the current P2P architecture does not have. Future consideration.

---

## Implementation Notes

**Server — no changes required.** The existing `queue_peer_envelope` handler already supports sending announcements from the new device on behalf of the old user, because it does not validate `from_user_id` against the sending client's identity. Routing, online delivery, and offline queuing all work as-is.

**Client — new device side:**
- Reuse `encryptNcryptsec` / NIP-49 for the old-key import step — no new crypto primitives needed.
- After import, the merge flow calls `queue_peer_envelope` for each friend in the old user's friend list, with `from_user_id: old_pubkey` and the announcement encrypted to each friend's pubkey and signed by the old private key. This is a thin wrapper over the existing outbox/envelope mechanism.
- `freeze_seq` requires the outgoing event sequence counter to be accessible at the app-state level; verify whether it is already tracked in `data-model.ts`.
- Deprecated mode for the old user's local record can be persisted as a flag in IndexedDB so it survives page reload.
- Settings page needs a new entry: **Merge another account** (distinct from "Transfer user to another device").

**Client — friend side:**
- Add `merge_announcement` as a new handled message kind in `bridge.js` / `processInnerPeerMessage`.
- On receipt: validate signature, check idempotency by `merge_id`, update peer list, trigger the dual-connection reconciliation flow if needed, send MergeAck.
- After processing, add `new_pubkey` to `peer_candidates` and re-register with the server so WebRTC with the new user can be established on next mutual online moment.
