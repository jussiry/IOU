# Glossary

Project-specific vocabulary for Tally (this repo, formerly "IOU"). The goal is a
shared, precise language: the same word should mean the same thing in code,
docs, and conversation. When a term has a specific meaning here that differs
from its everyday or industry meaning, this is the place that pins it down.

## How to read this glossary

- **Synonyms are comma-separated in the entry heading, most-commonly-used term
  first.** e.g. **Record, Durable message** means both refer to the same thing,
  and "record" is the term you'll hear more often. Overlap is intentional — it's
  where a conversation is most likely to need clarification.
- **Focus is app-specific terms.** Generic/industry terms (WebRTC, STUN, Nostr…)
  appear only when they're crucial *and* used in a project-specific way.
- **Scope is the Tally app only** (`app/`, `server/`, `tests/`, `TIPs/`). The
  `GraphEditor/` and `web/` folders are effectively separate projects and are
  **not** covered here.
- Definitions are deliberately *definitional*, not implementation docs — they
  say what a term means, not how the code currently does it, so they age well.

---

## Core domain

**Tally** — three related meanings, usually clear from context: (1) the app
itself; (2) the running balance of debt between you and one friend — positive
means they owe you (synonyms in this sense: *balance*, *debt*, stored as
`debt_eur`); (3) the app's main page. "Signing a tally" = recording a
transaction. → see Transaction.

**Transaction, IOU, Record** — the act (and record) of the user taking on or
settling debt with a friend — "I owe you". The most common kind of durable
record. In the UI this is the *record* screen ("record a tally"); in the code
it's a `transaction` peer message. "IOU" is also the project's former name.
→ see Record, Tally.

**Friend, Connection** — an accepted peer relationship between two users.
"Connection" is the legacy term (still present as deprecated data-model
aliases); **friend** is the current word everywhere in UI and new code.

**Contact** — a cached public identity (npub + display name) of a person the
client has seen. Broader than *friend*: every friend has a contact, but a
contact is not necessarily an accepted friend.

**Payment request** — asking a friend to pay you. Accepting one materializes the
mirroring transaction on both sides. → see Transaction.

**Trust limit, Credit limit** — the maximum amount you allow a friend to owe
you. Lowering takes effect immediately; raising requires the friend's agreement
(sits pending until they echo it). "Credit limit" is the term used in the
message payload; "trust limit" is the UI/most-common term.

**Command** — a domain module under `app/js/commands/` that performs one user
action (friendship, transaction, payment request, trust limit, relays, stun…).
**Not** a CLI command. Each command loads state, validates, queues a peer
message, mirrors it to the ledger, and persists.

---

## Messages, ledger & sync

**Peer message** — any JSON message exchanged between two clients (friend↔friend
or a user's own device↔device). Has a type; may or may not be durable.

**Record, Durable message, Ledger entry** — a peer message that is a permanent
fact in the ledger (a transaction, friend request/accept, name change,
trust-limit change…) and therefore carries an authorship proof. "Record" is the
user-facing word; "durable message" is the transport term; "ledger entry" is its
stored form. Contrast: transport-only messages (ping/pong, sync, receipts) are
**non-durable** and carry no authorship. → see Ledger, Authorship proof.

**Ledger** — the append-only local log of every durable message the user has
authored or received. The source of truth from which all balances are derived.
Not a blockchain and not shared wholesale — it is reconciled peer-by-peer via
sync.

**Outbox** — the queue of outbound peer messages awaiting delivery, persisted so
they survive reloads and retries.

**Envelope** — the encrypted wrapper around a peer message. Routing fields
(id/from/to) stay in plaintext so the relay server can deliver it; the inner
message is encrypted to the recipient. Versioned: **v3** = NIP-44 (current),
**v2** = legacy AES-GCM (accepted on receipt only, to drain old messages).

**Authorship proof, Authorship** — a signed Nostr event embedded inside a
durable message proving *who* authored it, so forwarded/third-party records can
be trusted during sync. Replaced the older bare per-message signature.

**Sync (sync_hello / sync_data)** — the exchange two connected peers/devices use
to reconcile their ledgers: each offers what it has, the other sends back what's
missing. How a recovering or reconnecting device catches up.

**Receipt** — a transport-level acknowledgement that a peer message was
received. Non-durable; never enters the ledger.

**Push hint** — a small encrypted payload attached to a queued envelope so the
relay can wake an offline recipient via Web Push without learning its contents.

---

## Transport & connectivity

**Peer** — a remote endpoint the client connects to: a friend's device, or one
of the user's *own* other devices. Keyed by `(userId, deviceId)`.

**Mesh** — the WebRTC overlay of live peer connections. Split into two: the
**friend mesh** (one connection per friend device) and the **self-mesh** (one
connection per the user's *own* other devices, used to sync devices in
lock-step).

**Relay, Relay server, Signaling server** — Tally's own WebSocket server. It
does two jobs: relays WebRTC signaling so peers can connect, and does
store-and-forward of encrypted envelopes when a peer is offline (or when direct
P2P can't form). Distinct from a *TURN relay* and an ICE *relay candidate*
(below). The **main relay** is the server that served the app; **secondary
relays** are user-added in settings.

**Snapshot, Realtime snapshot** — the in-memory object built from persisted
state and handed to the transport layer: who to connect to, what to deliver, and
the KeyProvider to sign/encrypt with. Rebuilt whenever state changes.

**KeyProvider** — the single abstraction through which all signing and peer
encryption flow. Implementations: `local` (private key in-app) and `nip07`
(key held in a browser extension). Lets the private key live outside the app
without the rest of the code touching raw key material.

**WebRTC / data channel** — used here **only** to carry encrypted JSON app
messages peer-to-peer (never audio/video). The "green icon" state.

**STUN** — a public server used during connection setup so each peer can
discover its own public (reflexive) address, enabling direct connections across
networks. User-configurable in settings; defaults to Cloudflare.

**ICE candidate (host / srflx / relay)** — the address options WebRTC tries when
connecting: *host* = local network (same-LAN only), *srflx* = public address via
STUN (cross-network), *relay* = via a TURN server (not used here). Note "relay"
here is unrelated to Tally's *relay server*.

---

## Identity & cryptography

**Nostr, npub, nsec** — Tally identities are Nostr keys. `npub…` is the public
key (a user's id); `nsec…` is the secret key. Tally uses Nostr keys and
signatures but does **not** publish transactions to public Nostr relays.

**NIP-01 / NIP-07 / NIP-44 / NIP-49** — the Nostr standards in use: event/
signature format (01), browser-extension signer (07), encrypted payloads (44),
and passphrase-encrypted key export/`ncryptsec` (49).

**Schnorr / secp256k1** — the signature scheme and curve behind Nostr identities
and authorship proofs.

**TIP** — Tally Improvement Proposal: a design document under `TIPs/`. See
`TIPs/README.md` for the implemented-vs-draft convention.
