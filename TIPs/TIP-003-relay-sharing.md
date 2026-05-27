# TIP-003 (cont.): Telling Friends What Relays You Use

| Field   | Value |
|---------|-------|
| Number  | TIP-003 |
| Title   | Relay Sharing with Friends |
| Status  | Draft |
| Author  | Jussi Rytkönen |
| Created | 2026-05-21 |

> **Context:** The relay pool transport and Phase 1 schema fields are implemented — see `implemented/TIP-003-multiple-relay-servers.md`. This document covers the unimplemented phases.

---

## Summary

When a user is connected to a friend (over WebRTC) and **both sides have opted in**, they exchange a `my_relays` peer message. Each side stores the other's relay list in `friends[].relays`. The aggregated info is surfaced in the add-relay UI as a list of popular-among-your-friends relays you don't yet use, to help users converge on overlapping relay sets without a central directory.

This complements the QR-code relay-hint approach (Open Question 1 in the base TIP) — that one handles new-friend discovery; this one keeps existing friends' relay sets fresh.

---

## Drawbacks

These shaped the design and are worth keeping in mind when the suggestion-ranking algorithm is built:

1. **Centralization-via-popularity.** A naive "most-used among friends" suggestion creates a network effect that pushes the social graph toward a few popular relays — exactly what multi-relay is trying to prevent. Friend networks overlap heavily; the popular list reinforces itself.
2. **Metadata aggregation by friends.** Each friend now carries a persisted copy of the user's relay set. A compromised friend gives an adversary a directory of every relay the user is on, including secondaries chosen for privacy.
3. **Sock-puppet manipulation.** A hostile relay operator can create fake friend identities, get added by real users, and inflate the popularity ranking of their own relay. Once a hostile relay reaches the suggested list, it onboards by social proof without anyone explicitly vetting it.
4. **Stale data, no clean revocation.** The user can't reliably "untell" a friend that they've stopped using relay X, especially friends offline at the moment of change. Stale info will accumulate.
5. **Cross-friend linkability.** Unusual relay overlap between two friends can be used by a third party (who is friends with both) to infer that those two friends know each other — a side-channel leak of social-graph structure.
6. **Default-on raises consent expectations.** Relay choice is the kind of preference some users feel privately about. Default-on means a user who doesn't read the toggle carefully shares silently.

---

## Design

**State (already in schema):**
- `state.share_my_relays: boolean` — defaults to `true`. User toggles it in settings.
- `friends[].relays: string[]` — populated by inbound `my_relays` messages.

**Message — `my_relays`:**
```
{
  type: "my_relays",
  from_user_id: <user pubkey>,
  to_user_id: <friend pubkey>,
  payload: { relays: ["wss://...", ...] }   // urls only, no flags
}
```
- Sent when: a WebRTC channel opens with an eligible friend AND `share_my_relays` is true, debounced so we don't resend unchanged lists every reconnect.
- The list is the union the pool uses: main relay + secondary relays added in settings.

**Suggestion-ranking:**
- **Popularity ranking**: sort by number of friends using the relay. Any attempt to apply a "diversity bias" collapses to the same ranking when the signal is derived from the same friend list — a genuine diversity signal requires external data (out of scope).
- **Per-friend dedup**: count each friend's relay set once.
- **TTL**: drop entries older than N days so a long-disconnected friend doesn't anchor suggestions to defunct relays.
- **Floor**: don't suggest relays seen on fewer than M friends (Sybil resistance against drawback 3).

---

## Implementation Phases

### Phase 2

- `my_relays` peer message type: send on WebRTC channel open + debounce.
- Inbound handler that updates `friends[].relays`.
- Suggestion row in the add-relay form, ranked by friend-popularity with the floor + TTL above.

### Phase 3

- Per-relay private flag so the user can mark specific relays as not shared.
- Embedded relay hints in friend-add QR codes (asymmetric-relay-set mitigation from Open Question 1).
- TTL background job to drop expired relay info from `friends[].relays`.
