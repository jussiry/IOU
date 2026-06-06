# TIP-006: External Nostr Key Storage

| Field   | Value |
|---------|-------|
| Number  | TIP-006 |
| Title   | External Nostr Key Storage |
| Status  | Draft |
| Author  | Jussi Rytkönen |
| Created | 2026-06-05 |

---

## Summary

Tally should support external Nostr key storage as an optional identity backend while keeping the existing IndexedDB-stored local key flow. Users who prefer browser extensions, remote signers, or native signer apps can bring an existing Nostr key without revealing the private key to Tally.

The transport envelope remains Tally's current minimal envelope. Tally does **not** publish transactions as ordinary Nostr events, because Nostr event metadata (`pubkey`, `created_at`, `kind`, tags, event id, signature) would weaken Tally's current privacy model. Instead, Tally uses standard signer-compatible Nostr event signatures **inside the encrypted payload** as an authorship proof.

---

## Motivation

Tally already uses Nostr-compatible identity keys (`npub` / `nsec`) and secp256k1 Schnorr signatures. Today the app stores the private key locally and performs signing, ECDH, encryption, and decryption itself.

This is simple and fast, but it requires the Tally app to hold the user's private key. Many Nostr users already prefer external signers that keep private keys in a browser extension, mobile signer, remote signer, or dedicated key manager. Supporting those signers makes Tally easier to use with existing Nostr identities while reducing the number of apps that ever see the user's `nsec`.

The goal is **key custody flexibility**, not public Nostr relay interoperability for Tally transactions.

---

## Non-Goals

- Do not make Tally transactions public Nostr events.
- Do not send transaction type, amount, note, app-specific tags, or Nostr event metadata to public Nostr relays.
- Do not remove local IndexedDB key storage.
- Do not require all signers to support non-standard raw Schnorr digest signing.
- Do not change the server into a Nostr relay.

---

## Privacy Constraint

Current Tally envelopes intentionally expose as little metadata as possible to the relay:

```
{
  type: "peer_envelope",
  envelope_version: 2,
  id: <message id>,
  from_user_id: <sender npub>,
  to_user_id: <recipient npub>,
  ciphertext: <encrypted signed inner message>
}
```

A normal Nostr event would expose additional metadata:

```
{
  id: <event hash>,
  pubkey: <sender hex pubkey>,
  created_at: <unix timestamp>,
  kind: <event kind>,
  tags: [...],
  content: <encrypted payload>,
  sig: <signature>
}
```

Even when `content` is encrypted with NIP-44, the event shell remains visible. This leaks app protocol details, timestamps, tags, event ids, and potentially recipient hints. That is not acceptable for Tally's ledger and transaction privacy model.

Therefore Nostr events may be used as **private signed proof objects**, but not as the relay-visible transport envelope.

---

## Key Provider Model

Tally should introduce a key provider abstraction. At minimum:

```
KeyProvider {
  type: "local" | "nip07" | "nip46" | "nip55" | "custom"
  getPublicKeyHex(): Promise<string>
  signEvent(unsignedEvent): Promise<SignedNostrEvent>
  nip44Encrypt(peerPublicKeyHex, plaintext): Promise<string>
  nip44Decrypt(peerPublicKeyHex, ciphertext): Promise<string>
}
```

The existing local IndexedDB key path becomes one provider implementation. It can keep using local private key material and local crypto. External providers use the best available standard API:

- NIP-07 browser extensions: `window.nostr.getPublicKey`, `window.nostr.signEvent`, optional `window.nostr.nip44.encrypt/decrypt`.
- NIP-46 remote signers: `get_public_key`, `sign_event`, `nip44_encrypt`, `nip44_decrypt`.
- NIP-55 Android signers: `get_public_key`, `sign_event`, `nip44_encrypt`, `nip44_decrypt`.

If a custom signer exposes raw Schnorr digest signing, Tally may use it as an optimization or compatibility path, but broad support should be based on standard `sign_event`.

---

## Envelope Version 3

External-key support should introduce a new envelope version rather than changing version 2 in place.

Relay-visible shape:

```
{
  type: "peer_envelope",
  envelope_version: 3,
  id: <inner message id>,
  from_user_id: <sender npub>,
  to_user_id: <recipient npub>,
  ciphertext: <NIP-44 ciphertext or local-provider equivalent>
}
```

The server still routes by `to_user_id` and treats all envelope fields as untrusted claims. The recipient still decrypts, parses, and checks the decrypted inner fields against the outer envelope.

Version 3 changes:

- Encryption should use NIP-44-compatible encryption where supported.
- Durable Tally messages carry a Tally-specific signed Nostr event as their authorship proof.
- Sync transport messages and receipts do not need durable authorship signatures.

---

## Tally-Specific Signing Event

Because standard Nostr signers sign Nostr events rather than arbitrary Tally digests, Tally signs a private Nostr event whose `content` contains the Tally message.

Unsigned event given to the signer:

```
{
  kind: 177700,
  created_at: <unix seconds>,
  tags: [
    ["tally:v", "1"],
    ["tally:purpose", "inner_message"]
  ],
  content: JSON.stringify({
    schema: "tally.signed_message.v1",
    message: {
      id: <peer message id>,
      type: <peer message type>,
      from_user_id: <sender npub>,
      to_user_id: <recipient npub>,
      created_at: <ISO-8601 sender timestamp>,
      payload: <message payload>
    }
  })
}
```

The signer returns the full signed Nostr event:

```
{
  id: <nostr event id>,
  pubkey: <sender hex pubkey>,
  created_at: <unix seconds>,
  kind: 177700,
  tags: [
    ["tally:v", "1"],
    ["tally:purpose", "inner_message"]
  ],
  content: <same content string>,
  sig: <schnorr signature>
}
```

This event is never sent as the outer transport object. It is placed inside the encrypted Tally inner message.

Decrypted inner message:

```
{
  id: <peer message id>,
  type: <peer message type>,
  from_user_id: <sender npub>,
  to_user_id: <recipient npub>,
  created_at: <ISO-8601 sender timestamp>,
  payload: <message payload>,
  authorship: {
    scheme: "tally-nostr-event-v1",
    event: <signed Nostr event>
  }
}
```

The signed event's Nostr metadata is visible only to the decrypting recipient.

---

## Verification Rules

For durable peer messages, the receiver MUST verify:

1. The envelope decrypts successfully.
2. The decrypted inner message is valid JSON.
3. `inner.id`, `inner.from_user_id`, and `inner.to_user_id` match the relay-visible envelope claims.
4. `inner.to_user_id` is the receiving user's own id.
5. `inner.authorship.scheme` is supported.
6. The embedded Nostr event id is correct for the event body.
7. The embedded Nostr event signature verifies against `event.pubkey`.
8. `event.pubkey` corresponds to `inner.from_user_id`.
9. The event has Tally's expected kind, version tag, and purpose tag.
10. `JSON.parse(event.content).schema === "tally.signed_message.v1"`.
11. `JSON.parse(event.content).message` exactly matches the decrypted inner message fields, excluding `authorship`.

Only after these checks may the message be applied or appended to the ledger.

---

## Signing Call Sites

Current Tally signing is centralized enough that this change should be manageable.

### Durable outbox messages

`queuePeerMessage` signs messages used by:

- `transaction_created`
- `payment_request`
- `payment_request_response`
- `friend_request`
- `friend_accept`
- `trust_limit_suggestion`
- `name_changed`

Current behavior:

```
message.signature = signInnerMessage(message, privateKey)
```

New behavior:

```
message.authorship = signTallyMessage(message, keyProvider)
```

where `signTallyMessage` creates the Tally-specific signing event and calls `keyProvider.signEvent`.

### Initial self-name ledger entry

Fresh identity creation currently creates a self-addressed `name_changed` entry signed by the new private key.

New behavior is the same durable-message path:

```
initMsg.authorship = signTallyMessage(initMsg, keyProvider)
appendLedgerEntryFromMessage(state, initMsg)
```

For local-key users this stays silent. For external-key users this may trigger one signer approval during onboarding.

### Envelope fallback signing

`wrapPeerMessage` currently signs a message if it lacks a signature. Version 3 should avoid treating all wrapped messages as durable ledger facts.

For durable messages, `wrapPeerMessage` should require an existing `authorship` proof or create one via the key provider.

For non-durable transport messages, `wrapPeerMessage` should be able to encrypt without authorship proof.

### Sync transport messages

Sync envelopes do not need their own durable signature. They are transport containers. The security-critical facts inside sync batches are the ledger entries, and each ledger entry carries its own authorship proof.

Version 3 sync messages should therefore be encrypted/authenticated by the envelope but not signed as durable Tally messages.

### Receipts

Receipts are acknowledgements and do not need durable authorship signatures. If a receipt must cross the relay, it should be encrypted in an envelope but should not require signer approval.

---

## Ledger Data Structure

The ledger should remain a Tally semantic ledger, not become a list of raw Nostr events.

Recommended shape:

```
LedgerEntryModel {
  id: string,
  timestamp: string,
  type: string,
  from_user_id: string,
  to_user_id: string,
  originated_at: string,
  payload: object,
  authorship: AuthorshipProof
}
```

For version 3 entries:

```
AuthorshipProof {
  scheme: "tally-nostr-event-v1",
  event: {
    id: string,
    pubkey: string,
    created_at: number,
    kind: number,
    tags: string[][],
    content: string,
    sig: string
  }
}
```

For legacy version 2 entries, Tally may keep the old field during migration:

```
signature: <legacy schnorr signature over canonical Tally digest>
```

or normalize it into:

```
AuthorshipProof {
  scheme: "tally-canonical-schnorr-v1",
  signature: <legacy signature>
}
```

The cleaner long-term form is one `authorship` field with a `scheme` discriminator. This avoids filling the ledger with parallel signature fields while still allowing old entries to verify.

### Why not store only the signed Nostr event?

Storing only the signed event would make the ledger depend on parsing `event.content` for every query, balance reconstruction, sync slice, and UI operation. It would also let Nostr's generic event shape leak into every Tally data path.

Keeping the semantic fields at the top level preserves the current ledger ergonomics:

- `type` remains directly queryable.
- `from_user_id` and `to_user_id` remain directly queryable.
- `originated_at` remains directly available for ordering and replay.
- `payload` remains the message-type-specific Tally object.
- `authorship` is a proof attached to the record, not the record itself.

The duplication between top-level fields and the signed event content is intentional. Verification requires the two copies to match exactly. If they do not match, the entry is rejected.

---

## Storage for External-Key Users

External-key accounts should not store `private_key` or `private_key_hex`.

The local user record should store:

```
{
  id: <npub>,
  public_key: <npub>,
  public_key_hex: <hex>,
  key_provider: {
    type: "nip07" | "nip46" | "nip55" | "custom",
    provider_id: <optional provider identifier>,
    permissions: <optional cached permission hints>
  },
  private_key: "",
  private_key_hex: ""
}
```

Local-key accounts keep the existing private key fields and may set:

```
key_provider: { type: "local" }
```

---

## Performance

Local NIP-44-compatible encryption is not expected to meaningfully affect Tally performance for normal message sizes. Tally messages are small JSON payloads. The visible costs are more likely to come from:

- extension or remote-signer IPC,
- permission prompts,
- signer UI latency,
- network latency,
- IndexedDB and rendering work.

Tally should still avoid unnecessary external signer calls. In particular, sync transport messages and receipts should not ask for durable signatures.

---

## Migration

Tally should use versioned app-state migrations for this change. IndexedDB itself stores one `root_state` blob in one object store, so the database schema version does not need to change just because ledger fields change. The migration should run after `loadAppState()` and before `normalizeAppState()`, then save the migrated state once before the app starts using it.

Migration files should be bound to `DATA_MODEL_VERSION`:

```
Migration {
  version: <DATA_MODEL_VERSION migrated to>,
  migrate(rootState): rootState
}
```

On startup:

```
persisted = loadAppState()
migrated = runMigrations(persisted, persisted.model_version, DATA_MODEL_VERSION)
state = normalizeAppState(migrated)
if migrationsRan:
  saveAppState(state)
```

This keeps data migrations separate from IndexedDB object-store migrations. IndexedDB `DATABASE_VERSION` should only change when object stores or indexes change.

The external-key migration should support three cases:

1. Existing local-key users with legacy `signature` fields.
2. New local-key users producing `authorship.scheme = "tally-nostr-event-v1"` or legacy local signatures, depending on implementation phase.
3. External-key users producing `authorship.scheme = "tally-nostr-event-v1"`.

### Signature field migration

When the app version that understands `authorship` ships, add a migration from the previous `DATA_MODEL_VERSION` to the new one.

For every `ledger[]` entry:

```
if entry.authorship is absent and entry.signature is present:
  entry.authorship = {
    scheme: "tally-canonical-schnorr-v1",
    signature: entry.signature
  }
```

For every `outbox[]` message:

```
if message.authorship is absent and message.signature is present:
  message.authorship = {
    scheme: "tally-canonical-schnorr-v1",
    signature: message.signature
  }
```

The migration may leave `signature` in place temporarily for rollback/debuggability, but new model factories should prefer `authorship`. A later cleanup migration can remove `signature` once all verification paths use `authorship`.

During migration and the compatibility window, verification should accept:

```
authorship.scheme === "tally-nostr-event-v1"
```

and:

```
signature
```

or:

```
authorship.scheme === "tally-canonical-schnorr-v1"
```

Once all active data has migrated, the old top-level `signature` field can be deprecated.

The signature-to-authorship migration should **not** run before the app implements `authorship` in `LedgerEntryModel`, `PeerMessageModel`, signing, verification, and sync. Otherwise normalization would either strip the new field or the rest of the app would ignore it.

---

## Open Questions

1. Should local-key users also move immediately to `tally-nostr-event-v1`, or should local keys keep the existing canonical Schnorr signature until external-key support is stable?
2. What custom event kind should Tally use for private signing events?
3. Should the Tally signing event include minimal tags only, or include a message id tag for signer UI readability? Since the event is encrypted before transport, this is a recipient-visible and signer-visible choice rather than a relay-visible privacy issue.
4. How should signer approval UX be batched for multi-entry actions such as accepting a payment request that also creates a transaction?
5. Should NIP-44 encryption be mandatory for envelope version 3, or should local-key providers be allowed to use the current AES-GCM scheme until both peers advertise support?

---

## Recommendation

Implement external keys in layers:

1. Add the `KeyProvider` abstraction while keeping local-key behavior unchanged.
2. Add `authorship` as a ledger and peer-message proof field with legacy signature verification fallback.
3. Add Tally-specific Nostr signing events for durable messages.
4. Stop requiring durable signatures for sync transport messages and receipts.
5. Add envelope version 3 with NIP-44-compatible encryption.
6. Add NIP-07 support first, then NIP-46/NIP-55 where the app environment supports them.

This keeps Tally's ledger clean, preserves minimal transport metadata, and makes external Nostr key storage an additive capability rather than a rewrite of the app around public Nostr event transport.
