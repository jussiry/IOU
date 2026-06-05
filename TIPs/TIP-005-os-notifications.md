# TIP-005: OS Notifications via Encrypted Web Push

| Field   | Value |
|---------|-------|
| Number  | TIP-005 |
| Title   | OS Notifications via Encrypted Web Push |
| Status  | Draft (implemented, pending real-device verification) |
| Author  | Jussi Rytkönen |
| Created | 2026-06-05 |

---

## Summary

Tally can now raise **OS-level notifications** (lock screen / notification tray)
when a peer message arrives while the app is closed. It uses the standard Web
Push stack (VAPID + the browser vendor's push service) but keeps the
notification text **end-to-end encrypted**: the relay that triggers the push
never learns what the notification says.

OS notifications fire for three high-signal events:

- a friend sends you money (`transaction_created`)
- a friend requests money (`payment_request`)
- a friend sends a friend request (`friend_request`)

These are the only message types the policy treats as OS-notifiable. Everything
else (sync, receipts, name changes, trust-limit chatter) is deliberately
excluded — see "Notification layers" below.

---

## Notification layers

The app surfaces "something happened" through four layers. This TIP adds layer 4
and centralizes the layer-4 routing decision in
`app/js/notify/notification-policy.js`:

| # | Layer            | Where                                   | Lifetime / audience                         |
|---|------------------|-----------------------------------------|---------------------------------------------|
| 1 | Logs             | activity log (derived from the ledger)  | every event; diagnostic                     |
| 2 | In-app toasts    | `js/ui/notifications.js`                 | while app open & focused; transient         |
| 3 | Actionable boxes | friend page (derived from app state)    | persists while the prompting state exists   |
| 4 | OS notifications | Web Push → service worker               | reaches the user when the app is **closed** |

Adding a new OS-notifiable event is a single edit to `HINT_BUILDERS` in the
policy module.

---

## Why encrypted hints

A normal Web Push lets the **application server** put the notification text in
the payload. Here the relay is semi-trusted (it already only sees opaque
envelope ciphertext), so we don't want it composing or reading notification
text. Instead:

1. The **sender** knows the human-readable context (its own name, the amount).
   When it queues an envelope for an offline recipient, it also builds a short
   hint (`{ title, body }`), encrypts it **for the recipient** with the same
   secp256k1 ECDH + AES-256-GCM scheme used for envelope bodies
   (`crypto/peer-crypto.js`), and attaches it as `envelope.push_hint`.
2. The **relay** forwards `push_hint` (plus the plaintext `from_user_id` routing
   field) as the Web Push payload — only when no device of the recipient is
   online to receive the envelope over WebSocket.
3. The **recipient's service worker** decrypts the hint locally using the
   private key from IndexedDB and the sender's public key, then calls
   `showNotification`. If anything is missing (no key, malformed payload), it
   falls back to a generic "You have new Tally activity".

The relay therefore learns *that* a notification was sent and *to whom* (it
already knew both), but never the amount, the note, or the event type.

---

## Components

**Server**
- `server/push/push-service.js` — VAPID identity (env → cached file →
  generate), in-memory `userId → Map<endpoint, subscription>` store, and
  `sendToUser()` (prunes 404/410 endpoints).
- `server/signaling/websocket-server.js` — handles `push_subscribe` /
  `push_unsubscribe`; fires `pushService.sendToUser` from
  `handleQueuePeerEnvelope` when `!deliveredToAny`.
- `server/server.js` — `GET /push/vapid-public-key`.

**Client**
- `app/js/notify/notification-policy.js` — layer documentation + the
  message-type → hint mapping.
- `app/js/peer/client.js` — `flushOutbox` attaches the encrypted `push_hint`
  on the offline (server-queue) path; exposes `setPushSubscription` /
  `sendPushUnsubscribe` and a `getRealtimeClient()` singleton accessor.
- `app/js/signaling/socket-client.js` + `relay-pool.js` — carry the
  subscription, re-sent on every (re)register and fanned out to all relays.
- `app/js/push/push-subscribe.js` — permission + `pushManager.subscribe`
  handshake, device-local state, resync on app start.
- `app/sw-crypto-entry.js` → bundled to `dist/sw-crypto.js` (IIFE) — secp256k1
  ECDH decrypt for the SW (WebCrypto can't do secp256k1, and the SW is a classic
  worker that can't import the app's ESM).
- `app/sw.js` — `push` + `notificationclick` listeners.
- Settings → "Notifications" toggle (device-local).

---

## Privacy & security notes

- **Subscriptions are device-local.** Nothing about push is written to the
  synced app state — a subscription is meaningless on a device that didn't
  create it, and OS permission can't be granted remotely. The settings toggle
  reflects the live browser state.
- **VAPID public key is public** by design; it only authenticates pushes as
  originating from this server.
- **Hint plaintext never leaves the two endpoints.** Same trust model as the
  envelope body.
- **Generic fallback** ensures a logged-out / key-less device still shows a
  non-leaking notification rather than failing silently.

---

## Open questions / future work

1. **Per-event-type opt-in.** Today it's one on/off toggle. A future config
   could let users route specific event types to specific layers.
2. **Subscription persistence across server restarts.** Subscriptions are
   in-memory and self-heal on client reconnect (like the envelope queue). A
   durable store would close the gap where a push is missed in the window
   between a restart and the next reconnect.
3. **Real-device verification.** The encrypted-hint round trip can't be fully
   exercised in the preview browser; needs a home-screen PWA on a real device
   with a live push service.
