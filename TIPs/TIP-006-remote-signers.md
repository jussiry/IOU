# TIP-006 (cont.): NIP-46 Remote & NIP-55 Native Signers

| Field   | Value |
|---------|-------|
| Number  | TIP-006 |
| Title   | Remote & Native Nostr Signers |
| Status  | Draft |
| Author  | Jussi Rytkönen |
| Created | 2026-06-15 |

> **Context:** The external-key foundation — KeyProvider abstraction, `authorship`
> proofs, NIP-44 v2 transport (envelope v3), and **NIP-07** browser-extension
> support — is implemented and verified; see
> `implemented/TIP-006-external-nostr-key-storage.md`. This document covers the
> one remaining layer: **NIP-46 remote signers** and **NIP-55 Android native
> signers**. Both slot into the existing `KeyProvider` seam without changing the
> rest of the app.

---

## Summary

Add two more `KeyProvider` implementations alongside `local` and `nip07`:

- **NIP-46 (remote signer):** the private key lives in a separate signer
  service the user authorizes. Operations are JSON-RPC requests round-tripped
  over a relay/transport: `get_public_key`, `sign_event`, `nip44_encrypt`,
  `nip44_decrypt`.
- **NIP-55 (Android native signer):** the same operations exposed by a native
  signer app via the platform's signer intent/IPC: `get_public_key`,
  `sign_event`, `nip44_encrypt`, `nip44_decrypt`.

Neither exposes raw key material to Tally. Because envelope v3 is NIP-44-only
and all new durable entries already sign via `signEvent` (a standard Nostr
event, kind 177700), these providers need no new wire formats — they only
supply the four standard methods the `KeyProvider` interface already defines.

---

## Provider interface (already defined)

```
KeyProvider {
  type: "local" | "nip07" | "nip46" | "nip55" | "custom"
  getPublicKeyHex(): Promise<string>
  signEvent(unsignedEvent): Promise<SignedNostrEvent>
  nip44Encrypt(peerPublicKeyHex, plaintext): Promise<string>
  nip44Decrypt(peerPublicKeyHex, ciphertext): Promise<string>
}
```

- **NIP-46:** map each method to its RPC (`get_public_key`, `sign_event`,
  `nip44_encrypt`, `nip44_decrypt`) over the chosen NIP-46 transport; persist the
  signer connection / bunker descriptor so the provider can be rebuilt from
  state, the way the local and nip07 providers are built in
  `createKeyProviderFromState`.
- **NIP-55:** map each method to the Android signer intent/IPC equivalents.
- `signer_type` on the user model gains `"nip46"` / `"nip55"` (today it is
  `"local" | "nip07"`), and `createKeyProviderFromState` learns to build them.

`signCanonicalDigest` and the legacy AES-GCM `encryptForPeer/decryptFromPeer`
have no equivalent on these signers and should throw, exactly as the nip07
provider does — these accounts never produced v2 envelopes and always sign via
events.

---

## Signer UX

Unlike NIP-07 (mostly automatic once "always allow" is granted), these signers
are **not automatic.** Each `sign_event` / `nip44_*` is an async round-trip to a
remote service or separate app, often with a push/approval on another device.
The UI must:

- show an explicit pending state ("Approve this in your signer app"),
- tolerate multi-second latency and offline/unreachable signers (the action
  fails cleanly; nothing is half-applied),
- batch where possible (below) to minimize approvals.

### Approval batching

A single user action can produce several durable entries (e.g. accepting a
payment request that also creates a transaction, or onboarding's self-name
entry). For external signers, each durable entry is a separate `sign_event`.
The direction: group the entries of one user action and request their
signatures together / sequentially behind one "Approve in your signer"
affordance, rather than firing isolated prompts. Sync transport messages and
receipts are never signed, so they never prompt.

---

## Performance

The dominant per-message cost for these providers is **signer IPC**, not crypto:
NIP-46 round-trips each `nip44_encrypt/decrypt` and `sign_event` over its
transport, and NIP-55 crosses an app boundary. Tally should therefore:

- never request durable signatures for sync transport messages or receipts,
- cache the per-peer NIP-44 conversation key where the signer allows it,
- batch encrypt/decrypt and signing for a single user action (most impactful
  for NIP-46).

---

## Open Questions

1. Which NIP-46 transport(s) to support, and how to persist/restore the signer
   connection across reloads and devices.
2. How aggressively to batch approvals without making a single decline leave a
   user action partially applied.
3. Whether NIP-55 is in scope for Tally's current (web PWA) environment or only
   once a native/Android wrapper exists.

---

## Implementation outline

1. Extend `signer_type` and `createKeyProviderFromState` to recognize `nip46` /
   `nip55` and build the matching provider.
2. Implement `createNip46KeyProvider` (RPC transport) and, where the environment
   supports it, `createNip55KeyProvider` (native intent/IPC).
3. Add the pending-state UX and approval batching for grouped durable entries.
4. Extend onboarding to offer "connect a remote/native signer" beside the
   existing NIP-07 option.
5. Test against a real NIP-46 bunker and a NIP-55 signer app.
