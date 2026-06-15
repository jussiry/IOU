# TIP-006: External Nostr Key Storage

| Field   | Value |
|---------|-------|
| Number  | TIP-006 |
| Title   | External Nostr Key Storage |
| Status  | Implemented (layers 1–5) |
| Author  | Jussi Rytkönen |
| Created | 2026-06-05 |

> **Context:** The KeyProvider abstraction, `authorship` proofs and legacy
> signature migration, NIP-44 v2 transport (envelope v3 with v2 decrypt drain),
> and **NIP-07** browser-extension support are implemented and verified —
> including a successful real-signer test against nos2x. This document is the
> record of that implemented design. The remaining layer — **NIP-46 remote
> signers and NIP-55 Android signers** — is not implemented; its design
> continues in `../TIP-006-remote-signers.md`.

---

## Summary

Tally should support external Nostr key storage as an optional identity backend while keeping the existing IndexedDB-stored local key flow. Users who prefer browser extensions, remote signers, or native signer apps can bring an existing Nostr key without revealing the private key to Tally.

The transport envelope remains Tally's current minimal envelope. Tally does **not** publish transactions as ordinary Nostr events, because Nostr event metadata (`pubkey`, `created_at`, `kind`, tags, event id, signature) would weaken Tally's current privacy model. Instead, Tally uses standard signer-compatible Nostr event signatures **inside the encrypted payload** as an authorship proof.

Envelope encryption moves to **NIP-44 as the single scheme** for all key providers (local and external). The current bespoke `SHA-256(ECDH-x) → AES-256-GCM` scheme is retired, not kept alongside NIP-44. External signers (NIP-07/46/55) expose `nip44.encrypt/decrypt` and cannot speak Tally's custom scheme, so a local-key user and an external-key user can only interoperate if both use NIP-44. Maintaining two encryption schemes with capability negotiation would therefore be self-defeating bloat; v3 is NIP-44-only.

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

- Encryption uses **NIP-44 v2** for every provider. There is no AES-GCM path and no per-peer capability negotiation in v3 (see "Encryption Scheme" below).
- Durable Tally messages carry a Tally-specific signed Nostr event as their authorship proof.
- Sync transport messages and receipts do not need durable authorship signatures.

### Cutover

Because envelopes are **transient transport** (decrypted on arrival; nothing durable is stored in encrypted form), the cutover from v2/AES-GCM to v3/NIP-44 does not need a long dual-scheme coexistence. The only state that can still be v2 at cutover is:

- messages already sitting in the server queue, and
- a peer running an older app version mid-rollout.

For these, clients keep **v2 decrypt** alive as a short, read-only drain path; they never *send* v2. No capability advertising, no negotiated downgrade. Given the small user base and the PWA update flow (waiting-worker activation on reload), a hard send-side cutover with a brief tolerated-error window during rollout is acceptable. The v2 decrypt path can be removed in a later release once queues have drained and clients have updated.

---

## Encryption Scheme

Envelope v3 uses **NIP-44 v2** (ChaCha20 + HMAC-SHA256, keys derived via HKDF-SHA256 from the secp256k1 ECDH shared secret, with NIP-44's length-hiding padding).

### Provider responsibility

NIP-44 is part of the `KeyProvider` surface, not raw ECDH:

- **Local provider** implements `nip44Encrypt/Decrypt` directly with the bundled crypto primitives, using the locally-held private key.
- **External providers** delegate to the signer (`window.nostr.nip44.*` for NIP-07; `nip44_encrypt/nip44_decrypt` RPCs for NIP-46/NIP-55). The app never sees the private key.

This is why the conversation key is computed inside the provider — external signers own it and never expose the ECDH secret.

### Implementation

**Do not hand-roll NIP-44.** Its padding scheme, MAC-over-(`nonce ‖ ciphertext`), verify-before-decrypt ordering, and constant-time comparison are easy to get subtly wrong. Use an audited implementation with the official NIP-44 test vectors:

- Reference implementation: **`nostr-tools/nip44`** (`nip44.v2.encrypt/decrypt`, `getConversationKey(privHex, pubHex)`), maintained by Nostr core and shipped with the spec's test vectors.
- Underlying primitives: `@noble/ciphers` (chacha), `@noble/hashes` (hkdf/hmac/sha256), `@noble/curves` (secp256k1). Tally already vendors `@noble/curves` at `app/js/vendor/noble-secp256k1.js`.

The local provider should cache the per-peer **conversation key** (the HKDF-extract of the ECDH secret) exactly as the current code caches the derived AES key, so steady-state cost matches today's.

### Service-worker constraint

The service worker is a classic worker and already loads an esbuild IIFE bundle (`app/sw-crypto-entry.js` → `app/dist/sw-crypto.js`) for push-hint decryption. NIP-44 decrypt for the local provider is added to that same bundle. If bundle size matters, copy `nostr-tools`' nip44 implementation verbatim on top of the already-bundled noble primitives rather than re-deriving the padding/MAC logic.

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

NIP-44 is **not** hardware-accelerated the way AES-GCM is. WebCrypto natively provides HKDF, HMAC-SHA256, and SHA-256, but **not ChaCha20**, so NIP-44's cipher runs in pure JS (noble). AES-GCM, by contrast, uses native AES-NI.

This does not matter in practice, for two reasons:

1. **Payloads are tiny.** Tally messages are small JSON objects; ChaCha20 over a few hundred bytes is sub-millisecond. The native-vs-JS gap only shows up at MB-scale throughput.
2. **The dominant cost is shared and unchanged.** Both the old and new schemes perform a secp256k1 **ECDH** (BigInt scalar multiplication in pure JS — the reason the current code caches the derived key per peer). That dwarfs the symmetric layer. NIP-44 caches the per-peer conversation key the same way, so steady-state cost is effectively identical to today.

So the real latency to design around is **not** crypto but:

- extension or remote-signer IPC (NIP-46 round-trips each `nip44_encrypt/decrypt` and `sign_event` over the network),
- permission prompts and signer UI latency,
- network and IndexedDB/rendering work.

Tally should still avoid unnecessary external signer calls. In particular, sync transport messages and receipts must not ask for durable signatures, and encrypt/decrypt batching matters most for NIP-46.

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

The migration runs even though legacy signatures stay verifiable: it gives the whole app **one** field shape (`authorship` with a `scheme` discriminator) so signing, verification, normalization, and sync all read a single path instead of branching on "does this entry have `signature` or `authorship`?". This is the opposite of bloat — it collapses two field shapes into one. The migration may leave the raw top-level `signature` in place for one release for rollback/debuggability; a later cleanup migration removes it once `authorship` is the only field read.

Verification permanently accepts two **authorship schemes**:

```
authorship.scheme === "tally-nostr-event-v1"        // all new entries (local + external)
authorship.scheme === "tally-canonical-schnorr-v1"  // legacy, verify-only, never written
```

This dual *signing* path is **not** a temporary window. Ledger entries are immutable financial facts; existing entries are signed with the legacy canonical-Schnorr digest and are re-verified whenever a peer re-sends them during sync/merge. They cannot be re-signed (external-key users have no way to; timestamps and proofs are baked in). So `tally-canonical-schnorr-v1` verification stays as long as any pre-migration entry can appear in a sync — effectively permanent. It is a small, read-only switch case, not a parallel system.

> **Contrast with encryption.** Envelopes are transient transport, so the AES-GCM scheme can be cut cleanly (v2 decrypt kept only as a short drain path). Signatures protect durable history, so the legacy verify path stays. These two "keep both" decisions are independent and should not be conflated.

The signature-to-authorship migration should **not** run before the app implements `authorship` in `LedgerEntryModel`, `PeerMessageModel`, signing, verification, and sync. Otherwise normalization would either strip the new field or the rest of the app would ignore it.

---

## Resolved Decisions

- **Encryption (was Open Q#5):** NIP-44 v2 is **mandatory** for envelope v3, for all providers. No AES-GCM in v3 and no per-peer capability negotiation. v2 decrypt is kept only as a short read-only drain path.
- **New-entry signing (was Open Q#1):** All new durable entries — **including local-key users** — use `authorship.scheme = "tally-nostr-event-v1"`. The local provider produces the same Tally signing event internally; this keeps one signing/verification path. `tally-canonical-schnorr-v1` remains verify-only for legacy entries.

## Open Questions

1. What custom event kind should Tally use for private signing events? (Draft uses `177700`.)
2. Should the Tally signing event include minimal tags only, or include a message id tag for signer UI readability? Since the event is encrypted before transport, this is a recipient- and signer-visible choice rather than a relay-visible privacy issue.
3. How should signer approval UX be batched for multi-entry actions such as accepting a payment request that also creates a transaction? (See "Signer UX" below for the current direction.)

---

## Signer UX

The signing/encryption surface differs sharply by provider, and the UI must reflect that.

### Local provider

No UI. Signing, NIP-44 encrypt/decrypt all happen silently with the locally-held key, exactly as today. This is the default and the only path most users ever see.

### NIP-07 browser extension (e.g. nos2x, Alby)

Mostly automatic, but **not silent**: the extension owns the approval UX. `getPublicKey`, `signEvent`, and `nip44.encrypt/decrypt` each may pop the extension's own prompt. Well-behaved extensions let the user "always allow" a site, after which calls resolve without prompts. Tally's job is:

- detect `window.nostr` and offer it as a key option,
- call the standard methods and surface a non-blocking "waiting for your signer…" state while a call is pending,
- handle rejection/timeout gracefully (the action fails cleanly; nothing is half-applied).

There is **no Tally-drawn signing dialog** for NIP-07 — the extension is the trusted UI. Tally must not try to reproduce or wrap it.

### NIP-46 remote signer / NIP-55 native signer

Not implemented. These signers and their pending-state / approval-batching UX
are covered in the continuation doc `../TIP-006-remote-signers.md`.

### Onboarding / welcome page

Today the welcome page only offers "create a new identity" (and transfer/restore). It should mention that **external Nostr key storage is possible** — a user can bring an existing Nostr identity via a browser extension or remote signer instead of letting Tally hold the key.

For this first phase the copy stays **general and forward-looking**, since the external providers are not yet verified on real signers:

- A short line/secondary action such as "Already have a Nostr key? You can use a browser extension or signer app." 
- Behind it, if `window.nostr` is detected, offer "Use my Nostr extension"; otherwise show a brief explanation and link out to NIP-07/NIP-46 concepts.
- The default and prominent path remains "create a new identity" (local key).

The copy is intentionally vague at first and tightened as NIP-07 (then NIP-46/NIP-55) are actually tested. Reference signer for NIP-07 testing: **nos2x** (`https://github.com/fiatjaf/nos2x`).

---

## Recommendation

External keys were implemented in layers:

1. ✅ Add the `KeyProvider` abstraction (local provider only) while keeping behavior unchanged; route all signing/encryption through it.
2. ✅ Add `authorship` as the single ledger/peer-message proof field; migrate legacy `signature` → `authorship{scheme:"tally-canonical-schnorr-v1"}` (verify-only); add Tally-specific Nostr signing events (`tally-nostr-event-v1`) as the path for all new durable messages.
3. ✅ Stop requiring durable signatures for sync transport messages and receipts.
4. ✅ Add NIP-44 v2 to the local provider and the SW bundle; introduce envelope v3 (NIP-44 send-only, v2 decrypt as drain). Verify against NIP-44 official test vectors.
5. ✅ Add NIP-07 support (detect `window.nostr`, key-option in onboarding, pending-state UX) and the general welcome-page mention of external key storage. Test against nos2x.
6. ⬜ Add NIP-46/NIP-55 where the app environment supports them, with explicit approval/pending UX and signature batching. **Not implemented — see `../TIP-006-remote-signers.md`.**

This keeps Tally's ledger clean, preserves minimal transport metadata, uses one encryption scheme and one new-entry signing scheme, and makes external Nostr key storage an additive capability rather than a rewrite of the app around public Nostr event transport.
